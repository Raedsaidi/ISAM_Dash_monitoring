from datetime import datetime
import logging
import math
from typing import List, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request ,BackgroundTasks
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, or_
from urllib.parse import unquote

from app.core.db import get_db
from app.core.security import require_admin, TokenUser, get_current_user, security
from app.services.auth_client import fetch_current_user_profile
from app.models.isam_instance import ISAMInstance
from app.models.wan_template import WanTemplate
from app.models.config_history import ConfigHistory
from app.models.isam_data import ISAMDataType
from app.models.port_lock import PortLock
from app.services.isam_cache import get_cached_isam_data, load_cached_parsed_data
from app.services.isam_bootstrap import bootstrap_new_isam_instance
from app.models.wan_template import WanTemplate, WanTemplateScope
from app.models.wan_model import WanModel
from app.models.template_project import TemplateProject
from app.models.isam_schemas import (
    ISAMInstanceCreate,
    ISAMInstanceUpdate,
    ISAMInstanceRead,
    ISAMInstanceList,
    TestConnectionResult,
    RunCommandRequest,
    RunCommandResponse,
    PortItem,
    PortsResponse,
    MemoryUsageResponse,
    WanTemplateCreate,
    WanTemplateUpdate,
    WanTemplateRead,
    WanTemplateList,
    ApplyWanTemplateResponse,
    MyPortResponse,
    MyApplyTemplateRequest,
    ConfigHistoryRead,
    ConfigHistoryList,
    CachedPortsResponse,
    CachedMemoryUsageResponse,
    TemplateRenderRequest,
    TemplateRenderResponse,
    TemplateTestRequest,
    TemplateTestResponse,
    TemplateApplyLiveRequest,
    PortLockResponse,
    PortLockStatusResponse,
    LTSlotsResponse,
    LTPortsResponse,
    LTPortItem,
    LTSlotItem,
    WanModelCreate,
    WanModelUpdate,
    WanModelRead,
    WanModelList,
    TemplateProjectCreate,
    TemplateProjectUpdate,
    TemplateProjectRead,
    TemplateProjectList,
    PortTemplateStatusResponse,
)
from app.services.isam_connection import (
    ISAMConnectionService,
    test_connection_for_instance,
)
from app.services.isam_data import ISAMDataService
from app.services.isam_lt_cache import (
    load_cached_lt_slots,
    load_cached_lt_ports,
)

router = APIRouter(prefix="/isam", tags=["ISAM"])

logger = logging.getLogger(__name__)


# -------- Helpers --------

def get_instance_or_404(db: Session, instance_id: int) -> ISAMInstance:
    inst = db.query(ISAMInstance).filter(ISAMInstance.id == instance_id).first()
    if not inst:
        raise HTTPException(status_code=404, detail="ISAM instance not found.")
    return inst


def get_template_or_404(db: Session, template_id: int) -> WanTemplate:
    tpl = db.query(WanTemplate).filter(WanTemplate.id == template_id).first()
    if not tpl:
        raise HTTPException(status_code=404, detail="WAN template not found.")
    return tpl


def is_admin_role(role: str | None) -> bool:
    return role in ("ADMIN", "SUPER_ADMIN")


def ensure_template_applicable_to_instance(
    tpl: WanTemplate,
    instance_id: int,
):
    if tpl.scope == WanTemplateScope.USER_INSTANCE.value:
        if tpl.isam_instance_id != instance_id:
            raise HTTPException(
                status_code=400,
                detail="This template is bound to another ISAM instance.",
            )


def ensure_template_visible_to_user(
    current_user: TokenUser,
    tpl: WanTemplate,
    *,
    instance_id: int | None = None,
):
    if is_admin_role(current_user.role):
        return

    if tpl.scope == WanTemplateScope.GLOBAL.value:
        return

    if (
        tpl.scope == WanTemplateScope.USER_INSTANCE.value
        and tpl.created_by == current_user.username
        and (instance_id is None or tpl.isam_instance_id == instance_id)
    ):
        return

    raise HTTPException(
        status_code=403,
        detail="You are not allowed to access this template.",
    )


def ensure_template_editable(
    current_user: TokenUser,
    tpl: WanTemplate,
):
    if is_admin_role(current_user.role):
        return

    if (
        tpl.scope == WanTemplateScope.USER_INSTANCE.value
        and tpl.created_by == current_user.username
    ):
        return

    raise HTTPException(
        status_code=403,
        detail="You are not allowed to edit this template.",
    )


def get_allowed_port_values_from_profile(profile: dict) -> list[str]:
    values: list[str] = []

    ports = profile.get("ports") or []
    if isinstance(ports, list):
        for p in ports:
            if isinstance(p, dict):
                v = str(p.get("value") or "").strip()
                if v:
                    values.append(v)

    if not values:
        old_port = str(profile.get("port_value") or "").strip()
        if old_port:
            values.append(old_port)

    return values


def ensure_selected_port_allowed_for_user(
    *,
    current_user: TokenUser,
    selected_port: str,
    credentials: HTTPAuthorizationCredentials,
):
    if current_user.role != "USER":
        return

    profile = fetch_current_user_profile(credentials.credentials)
    allowed_ports = get_allowed_port_values_from_profile(profile)

    if not allowed_ports:
        raise HTTPException(
            status_code=400,
            detail="No ports are assigned to this user.",
        )

    if selected_port not in allowed_ports:
        raise HTTPException(
            status_code=403,
            detail="Selected port is not assigned to this user.",
        )


def log_config_history(
    db: Session,
    *,
    username: str,
    action: str,
    isam_instance_id: int | None = None,
    port_id: str | None = None,
    template_id: int | None = None,
    success: bool = True,
    message: str | None = None,
    ip_address: str | None = None,
    commands_executed: list[str] | None = None,
    raw_output: str | None = None,
):
    history = ConfigHistory(
        username=username,
        action=action,
        isam_instance_id=isam_instance_id,
        port_id=port_id,
        template_id=template_id,
        success=success,
        message=message,
        ip_address=ip_address,
        commands_executed="\n".join(commands_executed or []) if commands_executed else None,
        raw_output=raw_output or None,
        created_at=datetime.utcnow(),
    )
    db.add(history)
    db.commit()


def ensure_port_not_locked_for_user(
    db: Session,
    instance_id: int,
    port_id: str,
    current_user: TokenUser,
):
    if current_user.role != "USER":
        return

    lock = db.query(PortLock).filter(
        PortLock.isam_instance_id == instance_id,
        PortLock.port_id == port_id
    ).first()

    if lock:
        raise HTTPException(
            status_code=403,
            detail=f"Port {port_id} is locked and cannot be used by USERs. Please contact your administrator.",
        )


def get_all_wan_model_names(db: Session) -> list[str]:
    """Récupère tous les noms de modèles WAN de la base."""
    models = db.query(WanModel.name).all()
    return [m.name for m in models]


def validate_template_wan_model(
    db: Session,
    template_name: str,
) -> str:
    """
    Vérifie que le nom du template contient un modèle WAN valide.
    Retourne le nom du modèle trouvé.
    Lève HTTPException 400 si aucun modèle n'est trouvé.
    """
    known_models = get_all_wan_model_names(db)

    if not known_models:
        logger.warning(
            "[WAN_MODEL] No WAN models defined in database. "
            "Skipping WAN model validation for template '%s'.",
            template_name,
        )
        return ""

    found_model = ISAMDataService.extract_wan_model_from_template_name(
        template_name,
        known_models,
    )

    if not found_model:
        raise HTTPException(
            status_code=400,
            detail=(
                f"No valid WAN model found in template name '{template_name}'. "
                f"The template name must contain one of the known WAN models. "
                f"Known models: {', '.join(sorted(known_models))}. "
                f"Example: 'GPON-DHCP_Orange' or 'ETHERNET_Djezzy'."
            ),
        )

    return found_model


# ── Helper pour WAN Models ──

def get_wan_model_or_404(db: Session, model_id: int) -> WanModel:
    m = db.query(WanModel).filter(WanModel.id == model_id).first()
    if not m:
        raise HTTPException(status_code=404, detail=f"WAN Model #{model_id} not found.")
    return m


# ── Helper pour Template Projects ──

def get_template_project_or_404(db: Session, project_id: int) -> TemplateProject:
    p = db.query(TemplateProject).filter(TemplateProject.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail=f"Template Project #{project_id} not found.")
    return p


# -------- INSTANCES --------

@router.post("/instances", response_model=ISAMInstanceRead)
def create_isam_instance(
    body: ISAMInstanceCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    inst = ISAMInstance(
        name=body.name,
        host=body.host,
        telnet_port=body.telnet_port,
        ssh_port=body.ssh_port,
        protocol_preference=body.protocol_preference,
        username=body.username,
        password=body.password,
        status="inactive",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(inst)
    db.commit()
    db.refresh(inst)

    client_ip = request.client.host if request.client else None
    log_config_history(
        db,
        username=current_user.username,
        action="CREATE_INSTANCE",
        isam_instance_id=inst.id,
        success=True,
        message="Instance created",
        ip_address=client_ip,
    )

    # Bootstrap initial en arrière-plan
    background_tasks.add_task(bootstrap_new_isam_instance, inst.id)

    return inst


@router.get("/instances", response_model=ISAMInstanceList)
def list_isam_instances(
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    instances = db.query(ISAMInstance).order_by(ISAMInstance.id.asc()).all()
    return ISAMInstanceList(instances=instances)


@router.get("/instances/{instance_id}", response_model=ISAMInstanceRead)
def get_isam_instance(
    instance_id: int,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    inst = get_instance_or_404(db, instance_id)
    return inst


@router.patch("/instances/{instance_id}", response_model=ISAMInstanceRead)
def update_isam_instance(
    instance_id: int,
    body: ISAMInstanceUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    inst = get_instance_or_404(db, instance_id)
    data = body.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(inst, field, value)
    inst.updated_at = datetime.utcnow()
    db.add(inst)
    db.commit()
    db.refresh(inst)

    client_ip = request.client.host if request.client else None
    log_config_history(
        db,
        username=current_user.username,
        action="UPDATE_INSTANCE",
        isam_instance_id=inst.id,
        success=True,
        message="Instance updated",
        ip_address=client_ip,
    )

    return inst


@router.delete("/instances/{instance_id}", status_code=204)
def delete_isam_instance(
    instance_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    inst = get_instance_or_404(db, instance_id)

    client_ip = request.client.host if request.client else None
    log_config_history(
        db,
        username=current_user.username,
        action="DELETE_INSTANCE",
        isam_instance_id=inst.id,
        success=True,
        message="Instance deleted",
        ip_address=client_ip,
    )

    db.delete(inst)
    db.commit()
    return


@router.post(
    "/instances/{instance_id}/test-connection",
    response_model=TestConnectionResult,
)
def test_isam_connection(
    instance_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    inst = get_instance_or_404(db, instance_id)

    ok, proto, msg, duration_ms = test_connection_for_instance(inst, timeout=10)

    inst.last_checked_at = datetime.utcnow()
    inst.last_response_time_ms = duration_ms
    if ok:
        inst.status = "active"
        inst.health_protocol_used = proto
        inst.last_error = None
    else:
        inst.status = "error"
        inst.health_protocol_used = None
        inst.last_error = msg

    db.add(inst)
    db.commit()
    db.refresh(inst)

    client_ip = request.client.host if request.client else None
    log_config_history(
        db,
        username=current_user.username,
        action="TEST_CONNECTION",
        isam_instance_id=inst.id,
        success=ok,
        message=msg,
        ip_address=client_ip,
    )

    return TestConnectionResult(
        success=ok,
        protocol_used=proto,
        status=inst.status,
        message=msg,
        response_time_ms=duration_ms,
        last_error=inst.last_error,
    )


@router.post(
    "/instances/{instance_id}/run-command",
    response_model=RunCommandResponse,
)
def run_command_on_isam(
    instance_id: int,
    body: RunCommandRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    inst = get_instance_or_404(db, instance_id)

    if not body.command.strip():
        raise HTTPException(
            status_code=400, detail="Command must not be empty."
        )

    original_pref = inst.protocol_preference
    if body.override_protocol:
        inst.protocol_preference = body.override_protocol

    try:
        service = ISAMConnectionService(inst)
        ok, proto, out, err = service.execute_command_preference(
            command=body.command.strip(),
            timeout=20,
        )
    finally:
        inst.protocol_preference = original_pref

    client_ip = request.client.host if request.client else None
    log_config_history(
        db,
        username=current_user.username,
        action="RUN_COMMAND",
        isam_instance_id=inst.id,
        success=ok,
        message=err or "Command executed",
        ip_address=client_ip,
        commands_executed=[body.command.strip()],
        raw_output=out,
    )

    return RunCommandResponse(
        success=ok,
        protocol_used=proto,
        stdout=out,
        stderr_or_message=err,
    )


# -------- MEMORY USAGE --------

@router.get(
    "/instances/{instance_id}/memory-usage",
    response_model=MemoryUsageResponse,
)
def get_memory_usage(
    instance_id: int,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    inst = get_instance_or_404(db, instance_id)
    data_service = ISAMDataService(inst)
    success, proto, raw_output, parsed, msg = data_service.get_memory_usage()

    return MemoryUsageResponse(
        success=success,
        protocol_used=proto,
        raw_output=raw_output or "",
        parsed=parsed or {},
        message=msg,
    )


# -------- PORTS --------

def parse_show_port(raw_output: str) -> List[PortItem]:
    ports: List[PortItem] = []
    current_board: str | None = None
    in_table: bool = False

    for line_orig in raw_output.splitlines():
        line = line_orig.rstrip("\n")
        stripped = line.strip()
        if not stripped:
            in_table = False
            continue

        if stripped.startswith("Ports on "):
            current_board = stripped[len("Ports on "):].strip()
            in_table = False
            continue

        if (
            stripped.lower().startswith("port")
            and "admin" in stripped.lower()
            and "link" in stripped.lower()
        ):
            in_table = True
            continue

        if stripped.startswith("=") or stripped.startswith("-"):
            continue

        if in_table and current_board:
            parts = stripped.split()
            if len(parts) < 10:
                logger.debug(
                    f"[PORTS] Ligne de port non reconnue (trop courte) : {line_orig!r}"
                )
                continue

            port_id = parts[0]
            admin_state = parts[1]
            link_state = parts[2]
            port_state = parts[3]
            cfg_mtu = parts[4]
            oper_mtu = parts[5]
            lag_bndl = parts[6]
            mode = parts[7]
            encap = parts[8]
            port_type = parts[9]

            try:
                cfg_mtu_int = int(cfg_mtu)
            except ValueError:
                cfg_mtu_int = 0
            try:
                oper_mtu_int = int(oper_mtu)
            except ValueError:
                oper_mtu_int = 0

            ports.append(
                PortItem(
                    board=current_board,
                    port_id=port_id,
                    admin_state=admin_state,
                    link_state=link_state,
                    port_state=port_state,
                    cfg_mtu=cfg_mtu_int,
                    oper_mtu=oper_mtu_int,
                    lag_bndl=lag_bndl,
                    mode=mode,
                    encap=encap,
                    port_type=port_type,
                )
            )

    return ports


@router.get(
    "/instances/{instance_id}/ports",
    response_model=PortsResponse,
)
def get_isam_ports(
    instance_id: int,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    inst = get_instance_or_404(db, instance_id)

    service = ISAMConnectionService(inst)
    script = "show\nport"
    ok, proto, out, err = service.execute_command_preference(
        command=script,
        timeout=30,
    )

    if not ok:
        return PortsResponse(
            success=False,
            protocol_used=proto,
            port_count=0,
            ports=[],
            raw_output=out or "",
            message=err or "Failed to execute 'show port'.",
        )

    ports = parse_show_port(out or "")
    return PortsResponse(
        success=True,
        protocol_used=proto,
        port_count=len(ports),
        ports=ports,
        raw_output=out or "",
        message="OK",
    )


# ================================================================
# ========  WAN MODELS  ==========================================
# ================================================================

@router.post("/wan-models", response_model=WanModelRead)
def create_wan_model(
    body: WanModelCreate,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    existing = db.query(WanModel).filter(WanModel.name == body.name.strip()).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"A WAN model with name '{body.name.strip()}' already exists.",
        )

    model = WanModel(
        name=body.name.strip(),
        description=body.description.strip() if body.description else None,
        created_by=current_user.username,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(model)
    db.commit()
    db.refresh(model)
    return model


@router.get("/wan-models", response_model=WanModelList)
def list_wan_models(
    search: str | None = Query(None, min_length=1, max_length=200),
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    q = db.query(WanModel)

    if search:
        pattern = f"%{search}%"
        q = q.filter(
            or_(
                WanModel.name.ilike(pattern),
                WanModel.description.ilike(pattern),
            )
        )

    models = q.order_by(WanModel.name.asc()).all()
    return WanModelList(models=models)


@router.get("/wan-models/{model_id}", response_model=WanModelRead)
def get_wan_model(
    model_id: int,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    return get_wan_model_or_404(db, model_id)


@router.patch("/wan-models/{model_id}", response_model=WanModelRead)
def update_wan_model(
    model_id: int,
    body: WanModelUpdate,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    model = get_wan_model_or_404(db, model_id)
    data = body.model_dump(exclude_unset=True)

    if "name" in data and data["name"]:
        new_name = data["name"].strip()
        existing = db.query(WanModel).filter(
            WanModel.name == new_name,
            WanModel.id != model_id,
        ).first()
        if existing:
            raise HTTPException(
                status_code=409,
                detail=f"A WAN model with name '{new_name}' already exists.",
            )
        data["name"] = new_name

    for field, value in data.items():
        setattr(model, field, value)

    model.updated_at = datetime.utcnow()
    db.add(model)
    db.commit()
    db.refresh(model)
    return model


@router.delete("/wan-models/{model_id}", status_code=204)
def delete_wan_model(
    model_id: int,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    model = get_wan_model_or_404(db, model_id)
    db.delete(model)
    db.commit()
    return


# ================================================================
# ========  TEMPLATE PROJECTS  ===================================
# ================================================================

@router.post("/template-projects", response_model=TemplateProjectRead)
def create_template_project(
    body: TemplateProjectCreate,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    existing = db.query(TemplateProject).filter(
        TemplateProject.name == body.name.strip()
    ).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"A template project with name '{body.name.strip()}' already exists.",
        )

    project = TemplateProject(
        name=body.name.strip(),
        description=body.description.strip() if body.description else None,
        created_by=current_user.username,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get("/template-projects", response_model=TemplateProjectList)
def list_template_projects(
    search: str | None = Query(None, min_length=1, max_length=200),
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    q = db.query(TemplateProject)

    if search:
        pattern = f"%{search}%"
        q = q.filter(
            or_(
                TemplateProject.name.ilike(pattern),
                TemplateProject.description.ilike(pattern),
            )
        )

    projects = q.order_by(TemplateProject.name.asc()).all()
    return TemplateProjectList(projects=projects)


@router.get("/template-projects/{project_id}", response_model=TemplateProjectRead)
def get_template_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    return get_template_project_or_404(db, project_id)


@router.patch("/template-projects/{project_id}", response_model=TemplateProjectRead)
def update_template_project(
    project_id: int,
    body: TemplateProjectUpdate,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    project = get_template_project_or_404(db, project_id)
    data = body.model_dump(exclude_unset=True)

    if "name" in data and data["name"]:
        new_name = data["name"].strip()
        existing = db.query(TemplateProject).filter(
            TemplateProject.name == new_name,
            TemplateProject.id != project_id,
        ).first()
        if existing:
            raise HTTPException(
                status_code=409,
                detail=f"A template project with name '{new_name}' already exists.",
            )
        data["name"] = new_name

    if "description" in data and data["description"]:
        data["description"] = data["description"].strip()

    for field, value in data.items():
        setattr(project, field, value)

    project.updated_at = datetime.utcnow()
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.delete("/template-projects/{project_id}", status_code=204)
def delete_template_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    project = get_template_project_or_404(db, project_id)
    db.delete(project)
    db.commit()
    return


# ================================================================
# ========  WAN TEMPLATES  =======================================
# ================================================================

@router.post("/wan-templates", response_model=WanTemplateRead)
def create_wan_template(
    body: WanTemplateCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    if body.scope == WanTemplateScope.GLOBAL.value:
        if not is_admin_role(current_user.role):
            raise HTTPException(
                status_code=403,
                detail="Only ADMIN / SUPER_ADMIN can create global templates.",
            )
        instance_id = None

    elif body.scope == WanTemplateScope.USER_INSTANCE.value:
        if not body.isam_instance_id:
            raise HTTPException(
                status_code=400,
                detail="isam_instance_id is required for USER_INSTANCE templates.",
            )
        _ = get_instance_or_404(db, body.isam_instance_id)
        instance_id = body.isam_instance_id

    else:
        raise HTTPException(status_code=400, detail="Invalid template scope.")

    source_template = None
    if body.source_template_id is not None:
        source_template = get_template_or_404(db, body.source_template_id)
        ensure_template_visible_to_user(
            current_user,
            source_template,
            instance_id=instance_id,
        )

    tpl = WanTemplate(
        isam_instance_id=instance_id,
        name=body.name.strip(),
        project=body.project.strip() if body.project else None,
        commands_template=body.commands_template,
        created_by=current_user.username,
        scope=body.scope,
        source_template_id=source_template.id if source_template else None,
        saved_parameters=body.saved_parameters.model_dump() if body.saved_parameters else None,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(tpl)
    db.commit()
    db.refresh(tpl)

    client_ip = request.client.host if request.client else None
    log_config_history(
        db,
        username=current_user.username,
        action="CREATE_TEMPLATE_GLOBAL"
        if tpl.scope == WanTemplateScope.GLOBAL.value
        else "CREATE_TEMPLATE_USER_COPY",
        isam_instance_id=tpl.isam_instance_id,
        template_id=tpl.id,
        success=True,
        message="Template created",
        ip_address=client_ip,
    )

    return tpl

@router.get("/wan-templates/my-existing-copy", response_model=WanTemplateRead)
def get_my_existing_copy(
    source_template_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    root_template = get_template_or_404(db, source_template_id)
    ensure_template_visible_to_user(current_user, root_template)

    existing_copy = (
        db.query(WanTemplate)
        .filter(
            WanTemplate.scope == WanTemplateScope.USER_INSTANCE.value,
            WanTemplate.created_by == current_user.username,
            WanTemplate.source_template_id == source_template_id,
        )
        .order_by(WanTemplate.updated_at.desc(), WanTemplate.id.desc())
        .first()
    )

    if not existing_copy:
        raise HTTPException(status_code=404, detail="No existing copy found.")

    return existing_copy


@router.get("/wan-templates", response_model=WanTemplateList)
def list_wan_templates(
    instance_id: int | None = Query(None, ge=1),
    creator: str | None = Query(None),
    scope: str | None = Query(None, description="Filter by scope: GLOBAL or USER_INSTANCE"),
    search: str | None = Query(None, min_length=1, max_length=200),
    project: str | None = Query(None, min_length=1, max_length=100, description="Filter by project"),
    mine: bool = Query(False, description="If true => only templates created by current user"),

    # NEW: pagination
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),

    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    PROJECT_NONE = "__NONE__"  # convention front -> backend

    q = db.query(WanTemplate)

    # ----- Scope filter -----
    if scope:
        scope_upper = scope.upper().strip()
        if scope_upper in (
            WanTemplateScope.GLOBAL.value,
            WanTemplateScope.USER_INSTANCE.value,
        ):
            q = q.filter(WanTemplate.scope == scope_upper)

    # ----- Project filter (backend) -----
    # - "__NONE__" => project IS NULL (ou vide si tu veux)
    # - sinon => match EXACT (case-insensitive), plus adapté à un dropdown
    if project:
        p = project.strip()
        if p == PROJECT_NONE:
            q = q.filter(or_(WanTemplate.project.is_(None), func.trim(WanTemplate.project) == ""))
        else:
            q = q.filter(func.lower(func.trim(WanTemplate.project)) == p.lower())

    # ----- Visibility rules -----
    if mine:
        q = q.filter(
            WanTemplate.scope == WanTemplateScope.USER_INSTANCE.value,
            WanTemplate.created_by == current_user.username,
        )
        if instance_id is not None:
            q = q.filter(WanTemplate.isam_instance_id == instance_id)

    else:
        if is_admin_role(current_user.role):
            if instance_id is not None:
                if not scope:
                    q = q.filter(
                        or_(
                            WanTemplate.scope == WanTemplateScope.GLOBAL.value,
                            WanTemplate.isam_instance_id == instance_id,
                        )
                    )
                else:
                    scope_upper = scope.upper().strip() if scope else ""
                    if scope_upper == WanTemplateScope.USER_INSTANCE.value:
                        q = q.filter(WanTemplate.isam_instance_id == instance_id)

            if creator:
                q = q.filter(WanTemplate.created_by == creator)

        else:
            if instance_id is not None:
                q = q.filter(
                    or_(
                        WanTemplate.scope == WanTemplateScope.GLOBAL.value,
                        and_(
                            WanTemplate.scope == WanTemplateScope.USER_INSTANCE.value,
                            WanTemplate.created_by == current_user.username,
                            WanTemplate.isam_instance_id == instance_id,
                        ),
                    )
                )
            else:
                q = q.filter(
                    or_(
                        WanTemplate.scope == WanTemplateScope.GLOBAL.value,
                        and_(
                            WanTemplate.scope == WanTemplateScope.USER_INSTANCE.value,
                            WanTemplate.created_by == current_user.username,
                        ),
                    )
                )

    # ----- Search filter -----
    if search:
        pattern = f"%{search}%"
        q = q.filter(
            or_(
                WanTemplate.name.ilike(pattern),
                WanTemplate.created_by.ilike(pattern),
                WanTemplate.commands_template.ilike(pattern),
                WanTemplate.scope.ilike(pattern),
                WanTemplate.project.ilike(pattern),
            )
        )

    # ===== Pagination backend =====
    total = q.order_by(None).count()
    total_pages = max(1, math.ceil(total / page_size)) if total else 1

    # clamp page to avoid empty pages after filters
    if page > total_pages:
        page = total_pages

    offset = (page - 1) * page_size

    templates = (
        q.order_by(WanTemplate.updated_at.desc(), WanTemplate.id.desc())
        .offset(offset)
        .limit(page_size)
        .all()
    )

    return WanTemplateList(
        templates=templates,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get("/wan-templates/{template_id}", response_model=WanTemplateRead)
def get_wan_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    tpl = get_template_or_404(db, template_id)
    ensure_template_visible_to_user(current_user, tpl)
    return tpl


@router.patch("/wan-templates/{template_id}", response_model=WanTemplateRead)
def update_wan_template(
    template_id: int,
    body: WanTemplateUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    tpl = get_template_or_404(db, template_id)
    ensure_template_editable(current_user, tpl)

    data = body.model_dump(exclude_unset=True)

    if "saved_parameters" in data and body.saved_parameters is not None:
        data["saved_parameters"] = body.saved_parameters.model_dump()

    for field, value in data.items():
        setattr(tpl, field, value)

    tpl.updated_at = datetime.utcnow()
    db.add(tpl)
    db.commit()
    db.refresh(tpl)

    client_ip = request.client.host if request.client else None
    log_config_history(
        db,
        username=current_user.username,
        action="UPDATE_TEMPLATE",
        isam_instance_id=tpl.isam_instance_id,
        template_id=tpl.id,
        success=True,
        message="Template updated",
        ip_address=client_ip,
    )

    return tpl


@router.delete("/wan-templates/{template_id}", status_code=204)
def delete_wan_template(
    template_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    tpl = get_template_or_404(db, template_id)
    ensure_template_editable(current_user, tpl)

    client_ip = request.client.host if request.client else None
    log_config_history(
        db,
        username=current_user.username,
        action="DELETE_TEMPLATE",
        isam_instance_id=tpl.isam_instance_id,
        template_id=tpl.id,
        success=True,
        message="Template deleted",
        ip_address=client_ip,
    )

    db.delete(tpl)
    db.commit()
    return


@router.post("/wan-templates/render", response_model=TemplateRenderResponse)
def render_wan_template(
    body: TemplateRenderRequest,
    current_user: TokenUser = Depends(get_current_user),
):
    rendered_script, rendered_commands, variables_detected = ISAMDataService.render_template_commands(
        body.commands_template,
        selected_port=body.selected_port,
        variables=body.variables,
    )

    return TemplateRenderResponse(
        variables_detected=variables_detected,
        rendered_script=rendered_script,
        rendered_commands=rendered_commands,
    )


@router.post("/wan-templates/test", response_model=TemplateTestResponse)
def test_wan_template(
    body: TemplateTestRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    inst = get_instance_or_404(db, body.instance_id)

    selected_port = (body.selected_port or "").strip()
    tpl = None

    # Si un template_id est fourni, charger la template pour récupérer son nom
    # et vérifier qu'elle est applicable à l'instance
    template_name_for_validation = (body.template_name or "").strip()

    if body.template_id is not None:
        tpl = get_template_or_404(db, body.template_id)
        ensure_template_visible_to_user(current_user, tpl, instance_id=inst.id)
        ensure_template_applicable_to_instance(tpl, inst.id)
        template_name_for_validation = tpl.name

    # Si un port est fourni, vérifier qu'il n'est pas verrouillé
    if selected_port:
        ensure_port_not_locked_for_user(
            db=db,
            instance_id=inst.id,
            port_id=selected_port,
            current_user=current_user,
        )

    # ── ÉTAPE 1 : Valider le WAN model depuis le nom du template ──
    wan_model_found = ""
    if template_name_for_validation:
        wan_model_found = validate_template_wan_model(db, template_name_for_validation)
        logger.info(
            "[TEST_TEMPLATE] WAN model validated: '%s' (from template '%s')",
            wan_model_found,
            template_name_for_validation,
        )

    data_service = ISAMDataService(inst)

    # ── ÉTAPE 2 : DOWN éventuel AVANT le template ──
    commands_executed: list[str] = []
    raw_output = ""
    pre_test_message = ""

    if wan_model_found and selected_port:
        down_ok, down_output, down_commands, down_msg = data_service.execute_bridge_port_down_if_needed(
            port=selected_port,
            wan_model=wan_model_found,
            timeout=30,
        )

        if down_commands:
            commands_executed.extend(down_commands)
            raw_output = (raw_output or "") + ("\n" if raw_output else "") + (down_output or "")

        if not down_ok:
            final_message = (
                f"Failed before testing template: down command failed for WAN model "
                f"'{wan_model_found}': {down_msg}"
            )

            client_ip = request.client.host if request.client else None
            log_config_history(
                db,
                username=current_user.username,
                action="TEST_TEMPLATE",
                isam_instance_id=inst.id,
                port_id=selected_port or None,
                template_id=body.template_id,
                success=False,
                message=final_message,
                ip_address=client_ip,
                commands_executed=commands_executed,
                raw_output=raw_output,
            )

            return TemplateTestResponse(
                success=False,
                protocol_used=None,
                rendered_commands=commands_executed,
                raw_output=raw_output,
                message=final_message,
            )

        if down_commands:
            pre_test_message = f"Down command executed for WAN model '{wan_model_found}'. "

    # ── ÉTAPE 3 : Exécuter le contenu du template ──
    success, proto, apply_output, msg, template_commands = data_service.apply_template_content(
        commands_template=body.commands_template,
        selected_port=selected_port,
        variables=body.variables,
        timeout=60,
    )

    commands_executed.extend(template_commands)
    raw_output = (raw_output or "") + ("\n" if raw_output and apply_output else "") + (apply_output or "")

    final_message = pre_test_message + msg

    # ── ÉTAPE 4 : Logger ──
    client_ip = request.client.host if request.client else None
    log_config_history(
        db,
        username=current_user.username,
        action="TEST_TEMPLATE",
        isam_instance_id=inst.id,
        port_id=selected_port or None,
        template_id=body.template_id,
        success=success,
        message=final_message,
        ip_address=client_ip,
        commands_executed=commands_executed,
        raw_output=raw_output,
    )

    return TemplateTestResponse(
        success=success,
        protocol_used=proto,
        rendered_commands=commands_executed,
        raw_output=raw_output,
        message=final_message,
    )

# ================================================================
# ========  APPLY LIVE (avec validation WAN model + cycle)  ======
# ================================================================

@router.post("/wan-templates/apply-live", response_model=ApplyWanTemplateResponse)
def apply_live_template(
    body: TemplateApplyLiveRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    inst = get_instance_or_404(db, body.instance_id)

    template_id = body.template_id
    tpl = None

    if current_user.role == "USER" and template_id is None:
        raise HTTPException(
            status_code=400,
            detail="template_id is required for USER live apply.",
        )

    if template_id is not None:
        tpl = get_template_or_404(db, template_id)
        ensure_template_visible_to_user(current_user, tpl, instance_id=inst.id)
        ensure_template_applicable_to_instance(tpl, inst.id)

    if not body.selected_port or not body.selected_port.strip():
        raise HTTPException(
            status_code=400,
            detail="selected_port is required.",
        )

    selected_port = body.selected_port.strip()

    ensure_selected_port_allowed_for_user(
        current_user=current_user,
        selected_port=selected_port,
        credentials=credentials,
    )

    ensure_port_not_locked_for_user(
        db=db,
        instance_id=inst.id,
        port_id=selected_port,
        current_user=current_user,
    )

    # ── ÉTAPE 1 : Déterminer le nom du template pour la validation WAN model ──
    template_name_for_validation = ""
    if tpl:
        template_name_for_validation = tpl.name

    # ── ÉTAPE 2 : Valider le WAN model dans le nom du template ──
    wan_model_found = ""
    if template_name_for_validation:
        wan_model_found = validate_template_wan_model(db, template_name_for_validation)
        logger.info(
            "[APPLY_LIVE] WAN model validated: '%s' (from template '%s')",
            wan_model_found,
            template_name_for_validation,
        )

    data_service = ISAMDataService(inst)

    # ── ÉTAPE 3 : Si nécessaire, exécuter le DOWN AVANT le template ──
    commands_executed: list[str] = []
    raw_output = ""
    pre_apply_message = ""

    if wan_model_found:
        down_ok, down_output, down_commands, down_msg = data_service.execute_bridge_port_down_if_needed(
            port=selected_port,
            wan_model=wan_model_found,
            timeout=30,
        )

        if down_commands:
            commands_executed.extend(down_commands)
            raw_output = (raw_output or "") + ("\n" if raw_output else "") + (down_output or "")

        if not down_ok:
            final_message = (
                f"Failed before applying template: down command failed for WAN model "
                f"'{wan_model_found}': {down_msg}"
            )

            client_ip = request.client.host if request.client else None
            log_config_history(
                db,
                username=current_user.username,
                action="APPLY_TEMPLATE_LIVE",
                isam_instance_id=inst.id,
                port_id=selected_port,
                template_id=template_id,
                success=False,
                message=final_message,
                ip_address=client_ip,
                commands_executed=commands_executed,
                raw_output=raw_output,
            )

            return ApplyWanTemplateResponse(
                success=False,
                protocol_used=None,
                commands_executed=commands_executed,
                raw_output=raw_output,
                message=final_message,
            )

        if down_commands:
            pre_apply_message = f"Down command executed for WAN model '{wan_model_found}'. "

    # ── ÉTAPE 4 : Exécuter les commandes du template ──
    success, proto, apply_output, msg, template_commands = data_service.apply_template_content(
        commands_template=body.commands_template,
        selected_port=selected_port,
        variables=body.variables,
        timeout=60,
    )

    commands_executed.extend(template_commands)
    raw_output = (raw_output or "") + ("\n" if raw_output and apply_output else "") + (apply_output or "")

    # ── ÉTAPE 5 : Construire le message final ──
    final_message = pre_apply_message + msg

    # ── ÉTAPE 6 : Logger ──
    client_ip = request.client.host if request.client else None
    log_config_history(
        db,
        username=current_user.username,
        action="APPLY_TEMPLATE_LIVE",
        isam_instance_id=inst.id,
        port_id=selected_port,
        template_id=template_id,
        success=success,
        message=final_message,
        ip_address=client_ip,
        commands_executed=commands_executed,
        raw_output=raw_output,
    )

    return ApplyWanTemplateResponse(
        success=success,
        protocol_used=proto,
        commands_executed=commands_executed,
        raw_output=raw_output,
        message=final_message,
    )

@router.post(
    "/instances/{instance_id}/ports/{port_id:path}/apply-template/{template_id}",
    response_model=ApplyWanTemplateResponse,
)
def apply_template_to_port(
    instance_id: int,
    port_id: str,
    template_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    inst = get_instance_or_404(db, instance_id)
    tpl = get_template_or_404(db, template_id)

    ensure_template_applicable_to_instance(tpl, inst.id)

    ensure_port_not_locked_for_user(
        db=db,
        instance_id=inst.id,
        port_id=port_id,
        current_user=current_user,
    )

    # ── ÉTAPE 1 : Valider le WAN model ──
    wan_model_found = validate_template_wan_model(db, tpl.name)

    data_service = ISAMDataService(inst)

    # ── ÉTAPE 2 : DOWN éventuel AVANT le template ──
    commands_executed: list[str] = []
    raw_output = ""
    pre_apply_message = ""

    if wan_model_found:
        down_ok, down_output, down_commands, down_msg = data_service.execute_bridge_port_down_if_needed(
            port=port_id,
            wan_model=wan_model_found,
            timeout=30,
        )

        if down_commands:
            commands_executed.extend(down_commands)
            raw_output = (raw_output or "") + ("\n" if raw_output else "") + (down_output or "")

        if not down_ok:
            final_message = (
                f"Failed before applying template: down command failed for WAN model "
                f"'{wan_model_found}': {down_msg}"
            )

            client_ip = request.client.host if request.client else None
            log_config_history(
                db,
                username=current_user.username,
                action="APPLY_TEMPLATE",
                isam_instance_id=inst.id,
                port_id=port_id,
                template_id=tpl.id,
                success=False,
                message=final_message,
                ip_address=client_ip,
                commands_executed=commands_executed,
                raw_output=raw_output,
            )

            return ApplyWanTemplateResponse(
                success=False,
                protocol_used=None,
                commands_executed=commands_executed,
                raw_output=raw_output,
                message=final_message,
            )

        if down_commands:
            pre_apply_message = f"Down command executed for WAN model '{wan_model_found}'. "

    # ── ÉTAPE 3 : Appliquer le template ──
    success, proto, apply_output, msg, template_commands = data_service.apply_template_content(
        commands_template=tpl.commands_template,
        selected_port=port_id,
        variables={},
    )

    commands_executed.extend(template_commands)
    raw_output = (raw_output or "") + ("\n" if raw_output and apply_output else "") + (apply_output or "")

    final_message = pre_apply_message + msg

    client_ip = request.client.host if request.client else None
    log_config_history(
        db,
        username=current_user.username,
        action="APPLY_TEMPLATE",
        isam_instance_id=inst.id,
        port_id=port_id,
        template_id=tpl.id,
        success=success,
        message=final_message,
        ip_address=client_ip,
        commands_executed=commands_executed,
        raw_output=raw_output,
    )

    return ApplyWanTemplateResponse(
        success=success,
        protocol_used=proto,
        commands_executed=commands_executed,
        raw_output=raw_output,
        message=final_message,
    )
# -------- MY ACCOUNT --------

@router.get("/my-port", response_model=MyPortResponse)
def get_my_port(
    instance_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    inst = get_instance_or_404(db, instance_id)

    profile = fetch_current_user_profile(credentials.credentials)
    port_value = profile.get("port_value")

    if not port_value:
        return MyPortResponse(
            success=False,
            instance_id=inst.id,
            port_id=None,
            port=None,
            message="No port assigned to this user (port_value is empty).",
        )

    service = ISAMConnectionService(inst)
    script = "show\nport"
    ok, proto, out, err = service.execute_command_preference(
        command=script,
        timeout=500,
    )

    if not ok:
        return MyPortResponse(
            success=False,
            instance_id=inst.id,
            port_id=port_value,
            port=None,
            message=err or "Failed to execute 'show port'.",
        )

    ports = parse_show_port(out or "")
    port = next((p for p in ports if p.port_id == port_value), None)

    if not port:
        return MyPortResponse(
            success=False,
            instance_id=inst.id,
            port_id=port_value,
            port=None,
            message="Port not found on this ISAM instance.",
        )

    return MyPortResponse(
        success=True,
        instance_id=inst.id,
        port_id=port_value,
        port=port,
        message="OK",
    )


@router.get("/my-templates", response_model=WanTemplateList)
def list_my_templates(
    instance_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    inst = get_instance_or_404(db, instance_id)

    q = db.query(WanTemplate).filter(WanTemplate.isam_instance_id == inst.id)

    if current_user.role == "USER":
        q = q.filter(WanTemplate.created_by == current_user.username)

    templates = q.order_by(WanTemplate.id.asc()).all()
    return WanTemplateList(templates=templates)


@router.post("/my-apply-template", response_model=ApplyWanTemplateResponse)
def apply_template_to_my_port(
    body: MyApplyTemplateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    inst = get_instance_or_404(db, body.instance_id)
    tpl = get_template_or_404(db, body.template_id)

    if tpl.isam_instance_id != inst.id:
        raise HTTPException(
            status_code=400,
            detail="WAN template does not belong to this ISAM instance.",
        )

    profile = fetch_current_user_profile(credentials.credentials)
    port_value = profile.get("port_value")

    if not port_value:
        raise HTTPException(
            status_code=400,
            detail="No port assigned to this user (port_value is empty).",
        )

    ensure_port_not_locked_for_user(
        db=db,
        instance_id=inst.id,
        port_id=port_value,
        current_user=current_user,
    )

    # ── Valider le WAN model ──
    wan_model_found = validate_template_wan_model(db, tpl.name)

    data_service = ISAMDataService(inst)
    success, proto, raw_output, msg, commands_executed = data_service.apply_wan_template(
        port_id=port_value,
        template=tpl,
    )

    # ── Si succès et WAN model trouvé, cycle admin-state ──
    cycle_message = ""
    if success and wan_model_found:
        cycle_ok, cycle_output, cycle_commands, cycle_msg = data_service.execute_admin_state_cycle(
            port=port_value,
            delay_seconds=2.0,
            timeout=30,
        )

        commands_executed.extend(cycle_commands)
        raw_output = (raw_output or "") + "\n" + cycle_output

        if cycle_ok:
            cycle_message = f" | Admin-state cycle OK for WAN model '{wan_model_found}'."
        else:
            cycle_message = f" | WARNING: Admin-state cycle FAILED: {cycle_msg}."

    final_message = msg + cycle_message

    client_ip = request.client.host if request.client else None
    log_config_history(
        db,
        username=current_user.username,
        action="APPLY_TEMPLATE_MY_PORT",
        isam_instance_id=inst.id,
        port_id=port_value,
        template_id=tpl.id,
        success=success,
        message=final_message,
        ip_address=client_ip,
        commands_executed=commands_executed,
        raw_output=raw_output,
    )

    return ApplyWanTemplateResponse(
        success=success,
        protocol_used=proto,
        commands_executed=commands_executed,
        raw_output=raw_output,
        message=final_message,
    )


# -------- CONFIG HISTORY --------

@router.get("/config-history", response_model=ConfigHistoryList)
def list_config_history(
    instance_id: int | None = Query(None, ge=1),
    port_id: str | None = Query(None),
    username: str | None = Query(None),
    action: str | None = Query(None),
    success: bool | None = Query(None),
    search: str | None = Query(None, min_length=1, max_length=200),
    limit: int = Query(25, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    q = db.query(ConfigHistory).order_by(ConfigHistory.created_at.desc())

    if instance_id is not None:
        q = q.filter(ConfigHistory.isam_instance_id == instance_id)
    if port_id:
        q = q.filter(ConfigHistory.port_id == port_id)
    if username:
        q = q.filter(ConfigHistory.username == username)
    if action:
        q = q.filter(ConfigHistory.action == action)
    if success is not None:
        q = q.filter(ConfigHistory.success == success)

    if search:
        pattern = f"%{search}%"
        q = q.filter(
            or_(
                ConfigHistory.username.ilike(pattern),
                ConfigHistory.action.ilike(pattern),
                ConfigHistory.port_id.ilike(pattern),
                ConfigHistory.message.ilike(pattern),
                ConfigHistory.ip_address.ilike(pattern),
                ConfigHistory.commands_executed.ilike(pattern),
                ConfigHistory.raw_output.ilike(pattern),
            )
        )

    total = q.count()
    items = q.offset(offset).limit(limit).all()

    return ConfigHistoryList(items=items, total=total)


@router.get("/my-config-history", response_model=ConfigHistoryList)
def list_my_config_history(
    instance_id: int | None = Query(None, ge=1),
    action: str | None = Query(None),
    success: bool | None = Query(None),
    search: str | None = Query(None, min_length=1, max_length=200),
    limit: int = Query(25, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    q = db.query(ConfigHistory).order_by(ConfigHistory.created_at.desc())
    q = q.filter(ConfigHistory.username == current_user.username)

    if instance_id is not None:
        q = q.filter(ConfigHistory.isam_instance_id == instance_id)
    if action:
        q = q.filter(ConfigHistory.action == action)
    if success is not None:
        q = q.filter(ConfigHistory.success == success)

    if search:
        pattern = f"%{search}%"
        q = q.filter(
            or_(
                ConfigHistory.username.ilike(pattern),
                ConfigHistory.action.ilike(pattern),
                ConfigHistory.port_id.ilike(pattern),
                ConfigHistory.message.ilike(pattern),
                ConfigHistory.ip_address.ilike(pattern),
                ConfigHistory.commands_executed.ilike(pattern),
                ConfigHistory.raw_output.ilike(pattern),
            )
        )

    total = q.count()
    items = q.offset(offset).limit(limit).all()

    return ConfigHistoryList(items=items, total=total)

# -------- CACHED DATA --------

@router.get(
    "/instances/{instance_id}/cached-memory-usage",
    response_model=CachedMemoryUsageResponse,
)
def get_cached_memory_usage(
    instance_id: int,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    _ = get_instance_or_404(db, instance_id)

    row = get_cached_isam_data(db, instance_id, ISAMDataType.MEMORY_USAGE)

    if row is None or not row.parsed_data:
        return CachedMemoryUsageResponse(
            success=False,
            protocol_used=None,
            raw_output="",
            parsed={},
            message="No cached memory usage snapshot available yet.",
            cached_at=None,
            last_refresh_at=row.last_refresh_at if row else None,
            last_refresh_success=row.last_refresh_success if row else False,
            last_refresh_error=row.last_refresh_error if row else None,
        )

    parsed = load_cached_parsed_data(row)

    return CachedMemoryUsageResponse(
        success=True,
        protocol_used=row.protocol_used,
        raw_output=row.raw_output or "",
        parsed=parsed,
        message="OK" if row.last_refresh_success else "Showing last successful cached snapshot.",
        cached_at=row.last_success_at,
        last_refresh_at=row.last_refresh_at,
        last_refresh_success=row.last_refresh_success,
        last_refresh_error=row.last_refresh_error,
    )


@router.get(
    "/instances/{instance_id}/cached-ports",
    response_model=CachedPortsResponse,
)
def get_cached_ports(
    instance_id: int,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    _ = get_instance_or_404(db, instance_id)

    row = get_cached_isam_data(db, instance_id, ISAMDataType.PORTS)

    if row is None or not row.parsed_data:
        return CachedPortsResponse(
            success=False,
            protocol_used=None,
            port_count=0,
            ports=[],
            raw_output="",
            message="No cached ports snapshot available yet.",
            cached_at=None,
            last_refresh_at=row.last_refresh_at if row else None,
            last_refresh_success=row.last_refresh_success if row else False,
            last_refresh_error=row.last_refresh_error if row else None,
        )

    parsed = load_cached_parsed_data(row)
    ports = parsed.get("ports", [])
    port_count = parsed.get("port_count", len(ports))

    return CachedPortsResponse(
        success=True,
        protocol_used=row.protocol_used,
        port_count=port_count,
        ports=ports,
        raw_output=row.raw_output or "",
        message="OK" if row.last_refresh_success else "Showing last successful cached snapshot.",
        cached_at=row.last_success_at,
        last_refresh_at=row.last_refresh_at,
        last_refresh_success=row.last_refresh_success,
        last_refresh_error=row.last_refresh_error,
    )


# ========== LT SLOTS & PORTS ==========

@router.get(
    "/instances/{instance_id}/lt-slots",
    response_model=LTSlotsResponse,
)
def get_lt_slots(
    instance_id: int,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    _ = get_instance_or_404(db, instance_id)

    cached = load_cached_lt_slots(db, instance_id)

    return LTSlotsResponse(
        success=cached["last_refresh_success"],
        protocol_used=cached["protocol_used"],
        slot_count=cached["slot_count"],
        slots=[LTSlotItem(**slot) for slot in cached["slots"]],
        raw_output=cached["raw_output"],
        message=cached["message"],
        cached_at=cached["last_success_at"],
        last_refresh_at=cached["last_refresh_at"],
        last_refresh_success=cached["last_refresh_success"],
        last_refresh_error=cached["last_refresh_error"],
    )


@router.get(
    "/instances/{instance_id}/lt-slots/{slot_id:path}/ports",
    response_model=LTPortsResponse,
)
def get_lt_slot_ports(
    instance_id: int,
    slot_id: str,
    search: Optional[str] = Query(None, description="Recherche libre"),
    port_type: Optional[str] = Query(None, description="Filtrer par type"),
    state: Optional[str] = Query(None, description="Filtrer par état"),
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    slot_id = unquote(slot_id)
    inst = get_instance_or_404(db, instance_id)
    cached = load_cached_lt_ports(db, instance_id, slot_id)

    all_ports = cached["ports"]
    total_all = len(all_ports)
    filtered_ports = list(all_ports)

    if search:
        s = search.strip().lower()
        filtered_ports = [
            p for p in filtered_ports
            if s in p.get("port_id", "").lower()
            or s in p.get("port_type", "").lower()
            or s in p.get("board", "").lower()
            or s in p.get("admin_state", "").lower()
            or s in p.get("port_state", "").lower()
            or s in p.get("mode", "").lower()
            or s in p.get("encap", "").lower()
        ]

    if port_type:
        pt = port_type.strip().lower()
        filtered_ports = [
            p for p in filtered_ports
            if pt in p.get("port_type", "").lower()
        ]

    if state:
        st = state.strip().lower()
        filtered_ports = [
            p for p in filtered_ports
            if p.get("port_state", "").lower() == st
            or p.get("admin_state", "").lower() == st
        ]

    port_ids = [p.get("port_id") for p in filtered_ports]
    locks_dict = {}
    if port_ids:
        locks = db.query(PortLock).filter(
            PortLock.isam_instance_id == instance_id,
            PortLock.port_id.in_(port_ids)
        ).all()
        for lock in locks:
            locks_dict[lock.port_id] = lock

    ports_with_lock = []
    for port in filtered_ports:
        port_id = port.get("port_id")
        port["locked"] = port_id in locks_dict
        ports_with_lock.append(LTPortItem(**port))

    return LTPortsResponse(
        success=cached["last_refresh_success"],
        protocol_used=cached["protocol_used"],
        port_count=len(ports_with_lock),
        total_count=total_all,
        ports=ports_with_lock,
        slot_id=cached["slot_id"],
        raw_output=cached["raw_output"],
        message="OK" if cached["last_refresh_success"] else
                "No snapshot available yet" if not cached["last_success_at"] else
                "Showing last successful snapshot (latest refresh failed)",
        search_query=search,
        filters_applied={
            k: v for k, v in {"port_type": port_type, "state": state}.items() if v
        } or None,
        cached_at=cached["last_success_at"],
        last_refresh_at=cached["last_refresh_at"],
        last_refresh_success=cached["last_refresh_success"],
        last_refresh_error=cached["last_refresh_error"],
    )

# ========== PORT TEMPLATE STATUS ==========

@router.get(
    "/instances/{instance_id}/ports/{port_id:path}/template-status",
    response_model=PortTemplateStatusResponse,
)
def get_port_template_status(
    instance_id: int,
    port_id: str,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    """Vérifie si un port a déjà été configuré par un template."""
    _ = get_instance_or_404(db, instance_id)

    apply_actions = [
        "APPLY_TEMPLATE",
        "APPLY_TEMPLATE_LIVE",
        "APPLY_TEMPLATE_MY_PORT",
    ]

    last_apply = (
        db.query(ConfigHistory)
        .filter(
            ConfigHistory.isam_instance_id == instance_id,
            ConfigHistory.port_id == port_id,
            ConfigHistory.success == True,
            ConfigHistory.action.in_(apply_actions),
        )
        .order_by(ConfigHistory.created_at.desc())
        .first()
    )

    if not last_apply:
        return PortTemplateStatusResponse(
            configured=False,
            port_id=port_id,
            instance_id=instance_id,
            last_template_id=None,
            last_template_name=None,
            last_project=None,
            last_applied_by=None,
            last_applied_at=None,
            apply_count=0,
            message="This port has never been configured by a template.",
        )

    template_name = None
    project = None
    if last_apply.template_id:
        tpl = db.query(WanTemplate).filter(
            WanTemplate.id == last_apply.template_id
        ).first()
        if tpl:
            template_name = tpl.name
            project = tpl.project

    apply_count = (
        db.query(ConfigHistory)
        .filter(
            ConfigHistory.isam_instance_id == instance_id,
            ConfigHistory.port_id == port_id,
            ConfigHistory.success == True,
            ConfigHistory.action.in_(apply_actions),
        )
        .count()
    )

    return PortTemplateStatusResponse(
        configured=True,
        port_id=port_id,
        instance_id=instance_id,
        last_template_id=last_apply.template_id,
        last_template_name=template_name,
        last_project=project,
        last_applied_by=last_apply.username,
        last_applied_at=last_apply.created_at,
        apply_count=apply_count,
        message=f"Last configured by '{last_apply.username}' on {last_apply.created_at}.",
    )
# ========== PORT LOCK ==========

@router.get(
    "/instances/{instance_id}/ports/{port_id:path}/lock-status",
    response_model=PortLockStatusResponse,
)
def get_port_lock_status(
    instance_id: int,
    port_id: str,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    inst = get_instance_or_404(db, instance_id)

    lock = db.query(PortLock).filter(
        PortLock.isam_instance_id == instance_id,
        PortLock.port_id == port_id
    ).first()

    if not lock:
        return PortLockStatusResponse(
            port_id=port_id,
            locked=False,
            locked_by=None,
            locked_at=None,
        )

    return PortLockStatusResponse(
        port_id=port_id,
        locked=True,
        locked_by=lock.locked_by if is_admin_role(current_user.role) else None,
        locked_at=lock.locked_at if is_admin_role(current_user.role) else None,
    )


@router.post(
    "/instances/{instance_id}/ports/{port_id:path}/lock",
    response_model=PortLockResponse,
)
def lock_port(
    instance_id: int,
    port_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    inst = get_instance_or_404(db, instance_id)

    existing = db.query(PortLock).filter(
        PortLock.isam_instance_id == instance_id,
        PortLock.port_id == port_id
    ).first()

    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Port {port_id} is already locked by {existing.locked_by}."
        )

    now = datetime.utcnow()
    lock = PortLock(
        isam_instance_id=instance_id,
        port_id=port_id,
        locked_by=current_user.username,
        locked_at=now,
        reason=None,
        created_at=now,
        updated_at=now,
    )
    db.add(lock)
    db.commit()
    db.refresh(lock)

    client_ip = request.client.host if request.client else None
    log_config_history(
        db,
        username=current_user.username,
        action="LOCK_PORT",
        isam_instance_id=instance_id,
        port_id=port_id,
        success=True,
        message=f"Port {port_id} locked",
        ip_address=client_ip,
    )

    return PortLockResponse(
        success=True,
        port_id=port_id,
        locked=True,
        locked_by=lock.locked_by,
        locked_at=lock.locked_at,
        message=f"Port {port_id} is now locked",
    )


@router.delete(
    "/instances/{instance_id}/ports/{port_id:path}/unlock",
    response_model=PortLockResponse,
)
def unlock_port(
    instance_id: int,
    port_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    inst = get_instance_or_404(db, instance_id)

    lock = db.query(PortLock).filter(
        PortLock.isam_instance_id == instance_id,
        PortLock.port_id == port_id
    ).first()

    if not lock:
        raise HTTPException(
            status_code=404,
            detail=f"Port {port_id} is not locked."
        )

    db.delete(lock)
    db.commit()

    client_ip = request.client.host if request.client else None
    log_config_history(
        db,
        username=current_user.username,
        action="UNLOCK_PORT",
        isam_instance_id=instance_id,
        port_id=port_id,
        success=True,
        message=f"Port {port_id} unlocked",
        ip_address=client_ip,
    )

    return PortLockResponse(
        success=True,
        port_id=port_id,
        locked=False,
        locked_by=None,
        locked_at=None,
        message=f"Port {port_id} is now unlocked",
    )