# app/routes/cisco_config_routes.py

"""
Saved config templates (functions) + live execution endpoints.
"""

import json
import logging
import time as _time
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import get_current_user, require_super_admin, TokenUser
from app.models.cisco_switch import CiscoSwitch, CiscoSavedConfig
from app.models.cisco_schemas import (
    SavedConfigCreate,
    SavedConfigUpdate,
    SavedConfigRead,
    SavedConfigListResponse,
    SavedConfigDeleteResponse,
    ExecuteConfigRequest,
    ExecuteConfigResponse,
    ConfigArgDef,
)
from app.services.cisco_client import CiscoConnectionService

router = APIRouter(prefix="/cisco/configs", tags=["Cisco Configs"])
logger = logging.getLogger(__name__)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _row_to_read(row: CiscoSavedConfig) -> SavedConfigRead:
    try:
        args = [ConfigArgDef(**a) for a in json.loads(row.args or "[]")]
    except Exception:
        args = []
    return SavedConfigRead(
        id=row.id,
        name=row.name,
        description=row.description or "",
        template=row.template,
        args=args,
        created_by=row.created_by,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def get_config_or_404(db: Session, config_id: int) -> CiscoSavedConfig:
    row = (
        db.query(CiscoSavedConfig)
        .filter(CiscoSavedConfig.id == config_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Saved config not found.")
    return row


# ─── Execute (MUST be before /{config_id} routes) ────────────────────────────

@router.post("/execute", response_model=ExecuteConfigResponse)
def execute_config(
    body: ExecuteConfigRequest,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    """
    Execute a command string against a switch.
    Always runs in enable mode for config commands.
    """
    sw = (
        db.query(CiscoSwitch)
        .filter(CiscoSwitch.id == body.switch_id)
        .first()
    )
    if not sw:
        raise HTTPException(status_code=404, detail="Switch not found.")

    if not body.command.strip():
        raise HTTPException(status_code=400, detail="Command must not be empty.")

    service = CiscoConnectionService(sw)
    start = _time.time()
    try:
        ok, proto, output, error = service.execute_command_preference(
            command=body.command.strip(),
            enable=True,
            timeout=30,
        )
    except Exception as e:
        return ExecuteConfigResponse(
            success=False,
            error=f"{type(e).__name__}: {e}",
        )

    elapsed = round((_time.time() - start) * 1000, 1)

    return ExecuteConfigResponse(
        success=ok,
        output=output if ok else None,
        error=error if not ok else None,
        protocol_used=proto,
        execution_time_ms=elapsed,
    )


# ─── CRUD ─────────────────────────────────────────────────────────────────────

@router.get("", response_model=SavedConfigListResponse)
def list_saved_configs(
    search: str = Query("", max_length=200),
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    """List all saved config templates, optionally filtered by name/description."""
    q = db.query(CiscoSavedConfig)
    if search.strip():
        term = f"%{search.strip()}%"
        q = q.filter(
            or_(
                CiscoSavedConfig.name.ilike(term),
                CiscoSavedConfig.description.ilike(term),
            )
        )
    rows = q.order_by(CiscoSavedConfig.name.asc()).all()
    return SavedConfigListResponse(
        success=True,
        configs=[_row_to_read(r) for r in rows],
        total=len(rows),
    )


@router.post("", response_model=SavedConfigRead, status_code=201)
def create_saved_config(
    body: SavedConfigCreate,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_super_admin),
):
    """Create a new saved config template. SUPER_ADMIN only."""
    existing = (
        db.query(CiscoSavedConfig)
        .filter(CiscoSavedConfig.name == body.name.strip())
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"A saved config named '{body.name}' already exists.",
        )
    now = datetime.utcnow()
    row = CiscoSavedConfig(
        name=body.name.strip(),
        description=body.description.strip() if body.description else "",
        template=body.template,
        args=json.dumps([a.model_dump() for a in body.args]),
        created_by=current_user.username,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    logger.info(
        "Created saved config '%s' by %s", row.name, current_user.username
    )
    return _row_to_read(row)


@router.put("/{config_id}", response_model=SavedConfigRead)
def update_saved_config(
    config_id: int,
    body: SavedConfigUpdate,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_super_admin),
):
    """Update a saved config template. SUPER_ADMIN only."""
    row = get_config_or_404(db, config_id)
    if body.name is not None:
        clash = (
            db.query(CiscoSavedConfig)
            .filter(
                CiscoSavedConfig.name == body.name.strip(),
                CiscoSavedConfig.id != config_id,
            )
            .first()
        )
        if clash:
            raise HTTPException(
                status_code=409,
                detail=f"A saved config named '{body.name}' already exists.",
            )
        row.name = body.name.strip()
    if body.description is not None:
        row.description = body.description.strip()
    if body.template is not None:
        row.template = body.template
    if body.args is not None:
        row.args = json.dumps([a.model_dump() for a in body.args])
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    logger.info(
        "Updated saved config id=%d by %s", config_id, current_user.username
    )
    return _row_to_read(row)


@router.delete("/{config_id}", response_model=SavedConfigDeleteResponse)
def delete_saved_config(
    config_id: int,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_super_admin),
):
    """Delete a saved config template. SUPER_ADMIN only."""
    row = get_config_or_404(db, config_id)
    name = row.name
    db.delete(row)
    db.commit()
    logger.info(
        "Deleted saved config '%s' by %s", name, current_user.username
    )
    return SavedConfigDeleteResponse(success=True, message=f"'{name}' deleted.")