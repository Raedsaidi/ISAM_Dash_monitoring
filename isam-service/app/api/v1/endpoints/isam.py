from datetime import datetime
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
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
from app.models.wan_template import WanTemplate, WanTemplateScope
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


# ✅ NEW: Check port not locked
def check_port_not_locked(
    db: Session,
    instance_id: int,
    port_id: str,
):
    """
    Vérifie qu'un port n'est pas locké.
    Lève une HTTPException si le port est locké.
    
    À utiliser avant d'appliquer une template sur un port.
    """
    lock = db.query(PortLock).filter(
        PortLock.isam_instance_id == instance_id,
        PortLock.port_id == port_id
    ).first()

    if lock:
        raise HTTPException(
            status_code=403,
            detail=f"Port {port_id} is locked and cannot be used. Please contact your administrator.",
        )


# -------- INSTANCES --------

@router.post("/instances", response_model=ISAMInstanceRead)
def create_isam_instance(
    body: ISAMInstanceCreate,
    request: Request,
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


# -------- MEMORY USAGE (show -> system -> memory-usage) --------

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


# -------- PORTS (show -> port) --------

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


# -------- WAN TEMPLATES (global admin + user instance copies) --------

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
        commands_template=body.commands_template,
        created_by=current_user.username,
        scope=body.scope,
        source_template_id=source_template.id if source_template else None,
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


from fastapi import Query, Depends
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_

@router.get("/wan-templates", response_model=WanTemplateList)
def list_wan_templates(
    instance_id: int | None = Query(None, ge=1),
    creator: str | None = Query(None),
    scope: str | None = Query(None),
    search: str | None = Query(None, min_length=1, max_length=200),

    # NEW: filtre "mes templates"
    mine: bool = Query(False, description="If true => only templates created by current user"),

    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    q = db.query(WanTemplate)

    # =========================================================
    # NEW: mine=true => uniquement les templates créés par moi
    # (On retourne des templates USER_INSTANCE seulement)
    # =========================================================
    if mine:
        q = q.filter(
            WanTemplate.scope == WanTemplateScope.USER_INSTANCE.value,
            WanTemplate.created_by == current_user.username,
        )
        if instance_id is not None:
            q = q.filter(WanTemplate.isam_instance_id == instance_id)

        # (optionnel) si tu veux permettre scope=GLOBAL même en mine=true,
        # supprime le filtre sur scope ci-dessus. Mais ton besoin dit "créés par lui même",
        # donc USER_INSTANCE est logique.

    else:
        # =========================================================
        # Logique existante (inchangée)
        # =========================================================
        if is_admin_role(current_user.role):
            if instance_id is not None:
                q = q.filter(
                    or_(
                        WanTemplate.scope == WanTemplateScope.GLOBAL.value,
                        WanTemplate.isam_instance_id == instance_id,
                    )
                )
            if creator:
                q = q.filter(WanTemplate.created_by == creator)
            if scope:
                q = q.filter(WanTemplate.scope == scope)
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

    # --- server-side search ---
    if search:
        pattern = f"%{search}%"
        q = q.filter(
            or_(
                WanTemplate.name.ilike(pattern),
                WanTemplate.created_by.ilike(pattern),
                WanTemplate.commands_template.ilike(pattern),
                WanTemplate.scope.ilike(pattern),
            )
        )

    templates = q.order_by(WanTemplate.updated_at.desc(), WanTemplate.id.desc()).all()
    return WanTemplateList(templates=templates)


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

    data_service = ISAMDataService(inst)
    success, proto, raw_output, msg, commands_executed = data_service.apply_template_content(
        commands_template=body.commands_template,
        selected_port=body.selected_port or "",
        variables=body.variables,
        timeout=60,
    )

    client_ip = request.client.host if request.client else None
    log_config_history(
        db,
        username=current_user.username,
        action="TEST_TEMPLATE",
        isam_instance_id=inst.id,
        success=success,
        message=msg,
        ip_address=client_ip,
        commands_executed=commands_executed,
        raw_output=raw_output,
    )

    return TemplateTestResponse(
        success=success,
        protocol_used=proto,
        rendered_commands=commands_executed,
        raw_output=raw_output,
        message=msg,
    )


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

    ensure_selected_port_allowed_for_user(
        current_user=current_user,
        selected_port=body.selected_port.strip(),
        credentials=credentials,
    )

    # ✅ NEW: Vérifier que le port n'est pas locké
    check_port_not_locked(db, inst.id, body.selected_port.strip())

    data_service = ISAMDataService(inst)
    success, proto, raw_output, msg, commands_executed = data_service.apply_template_content(
        commands_template=body.commands_template,
        selected_port=body.selected_port.strip(),
        variables=body.variables,
        timeout=60,
    )

    client_ip = request.client.host if request.client else None
    log_config_history(
        db,
        username=current_user.username,
        action="APPLY_TEMPLATE_LIVE",
        isam_instance_id=inst.id,
        port_id=body.selected_port.strip(),
        template_id=template_id,
        success=success,
        message=msg,
        ip_address=client_ip,
        commands_executed=commands_executed,
        raw_output=raw_output,
    )

    return ApplyWanTemplateResponse(
        success=success,
        protocol_used=proto,
        commands_executed=commands_executed,
        raw_output=raw_output,
        message=msg,
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

    # ✅ NEW: Vérifier que le port n'est pas locké
    check_port_not_locked(db, inst.id, port_id)

    data_service = ISAMDataService(inst)
    success, proto, raw_output, msg, commands_executed = data_service.apply_template_content(
        commands_template=tpl.commands_template,
        selected_port=port_id,
        variables={},
    )

    client_ip = request.client.host if request.client else None
    log_config_history(
        db,
        username=current_user.username,
        action="APPLY_TEMPLATE",
        isam_instance_id=inst.id,
        port_id=port_id,
        template_id=tpl.id,
        success=success,
        message=msg,
        ip_address=client_ip,
        commands_executed=commands_executed,
        raw_output=raw_output,
    )

    return ApplyWanTemplateResponse(
        success=success,
        protocol_used=proto,
        commands_executed=commands_executed,
        raw_output=raw_output,
        message=msg,
    )


# -------- MY ACCOUNT (PORT UTILISATEUR) --------

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

    # ✅ NEW: Vérifier que le port n'est pas locké
    check_port_not_locked(db, inst.id, port_value)

    data_service = ISAMDataService(inst)
    success, proto, raw_output, msg, commands_executed = data_service.apply_wan_template(
        port_id=port_value,
        template=tpl,
    )

    client_ip = request.client.host if request.client else None
    log_config_history(
        db,
        username=current_user.username,
        action="APPLY_TEMPLATE_MY_PORT",
        isam_instance_id=inst.id,
        port_id=port_value,
        template_id=tpl.id,
        success=success,
        message=msg,
        ip_address=client_ip,
        commands_executed=commands_executed,
        raw_output=raw_output,
    )

    return ApplyWanTemplateResponse(
        success=success,
        protocol_used=proto,
        commands_executed=commands_executed,
        raw_output=raw_output,
        message=msg,
    )


# -------- CONFIG HISTORY --------

@router.get("/my-config-history", response_model=ConfigHistoryList)
def list_my_config_history(
    instance_id: int | None = Query(None, ge=1),
    action: str | None = Query(None),
    success: bool | None = Query(None),
    search: str | None = Query(None, min_length=1, max_length=200),
    limit: int = Query(100, ge=1, le=1000),
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

    items = q.limit(limit).all()
    return ConfigHistoryList(items=items)


@router.get("/config-history", response_model=ConfigHistoryList)
def list_config_history(
    instance_id: int | None = Query(None, ge=1),
    port_id: str | None = Query(None),
    username: str | None = Query(None),
    action: str | None = Query(None),
    success: bool | None = Query(None),
    search: str | None = Query(None, min_length=1, max_length=200),
    limit: int = Query(100, ge=1, le=1000),
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

    items = q.limit(limit).all()
    return ConfigHistoryList(items=items)


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


# ========== LT SLOTS & PORTS (NEW) ==========

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
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    slot_id = unquote(slot_id)

    inst = get_instance_or_404(db, instance_id)

    cached = load_cached_lt_ports(db, instance_id, slot_id)

    locks_dict = {}
    locks = db.query(PortLock).filter(
        PortLock.isam_instance_id == instance_id,
        PortLock.port_id.in_([p.get("port_id") for p in cached["ports"]])
    ).all()

    for lock in locks:
        locks_dict[lock.port_id] = lock

    ports_with_lock = []
    for port in cached["ports"]:
        port_id = port.get("port_id")
        is_locked = port_id in locks_dict
        port["locked"] = is_locked
        ports_with_lock.append(LTPortItem(**port))

    return LTPortsResponse(
        success=cached["last_refresh_success"],
        protocol_used=cached["protocol_used"],
        port_count=cached["port_count"],
        ports=ports_with_lock,
        slot_id=cached["slot_id"],
        raw_output=cached["raw_output"],
        message="OK" if cached["last_refresh_success"] else 
                "No snapshot available yet" if not cached["last_success_at"] else 
                "Showing last successful snapshot (latest refresh failed)",
        cached_at=cached["last_success_at"],
        last_refresh_at=cached["last_refresh_at"],
        last_refresh_success=cached["last_refresh_success"],
        last_refresh_error=cached["last_refresh_error"],
    )

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
    """
    Récupère le status de lock d'un port.
    
    Accessible par tous les rôles (pour vérifier si un port est locké).
    """
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
    """
    Lock un port (empêche les USERs d'appliquer des templates dessus).
    
    Admin/SuperAdmin only.
    """
    inst = get_instance_or_404(db, instance_id)

    # Vérifier si déjà locké
    existing = db.query(PortLock).filter(
        PortLock.isam_instance_id == instance_id,
        PortLock.port_id == port_id
    ).first()

    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Port {port_id} is already locked by {existing.locked_by}."
        )

    # Créer le lock
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
    """
    Unlock un port (permet aux USERs d'appliquer des templates).
    
    Admin/SuperAdmin only.
    """
    inst = get_instance_or_404(db, instance_id)

    # Trouver le lock
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