# app/routes/cisco_routes.py
# Full corrected file

"""
REST endpoints for Cisco switch management.
"""

import json
import logging
import re
import time as _time
from datetime import datetime
from typing import Optional
from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import get_current_user, require_admin, TokenUser
from app.models.cisco_switch import (
    CiscoSwitch,
    CiscoPortLock,
    CiscoVlan,
    CiscoPortAssignment,
    CiscoPortSnapshot,
    CiscoInterfaceSnapshot,
    CiscoVlanSnapshot,
    CiscoPortConfigHistory,
)
from app.models.cisco_schemas import (
    SwitchCreate,
    SwitchUpdate,
    SwitchRead,
    SwitchListResponse,
    TestConnectionResult,
    CommandRequest,
    CommandResponse,
    DeviceInfoResponse,
    InterfacesResponse,
    InterfaceInfo,
    VlansResponse,
    VlanInfo,
    CiscoPortInfo,
    PortStatusResponse,
    PortLockToggleResponse,
    BulkLockResponse,
    VlanChangeRequest,
    VlanChangeResponse,
    PortConfigResponse,
    VlanMgmtCreate,
    VlanMgmtRead,
    VlanMgmtListResponse,
    VlanMgmtDeleteResponse,
    PortAssignmentCreate,
    PortAssignmentUpdate,
    PortAssignmentRead,
    PortAssignmentListResponse,
    VlanMgmtStatsResponse,
    PortStatusPageResponse,
    InterfacesPageResponse,
    VlansPageResponse,
    PortStats,
    SwitchOverviewSummary,
    OverviewResponse,
    PortConfigHistoryRead,
    PortConfigHistoryResponse,
    PortConfigHistoryHasResponse,
)
from app.services.cisco_client import (
    CiscoConnectionService,
    test_connection_for_switch,
    parse_show_version,
    parse_interfaces,
    parse_vlans,
    parse_running_config_vlan,
    expand_interface_name,
)

router = APIRouter(prefix="/cisco", tags=["Cisco"])
logger = logging.getLogger(__name__)


# ──────────── Helpers ────────────


def get_switch_or_404(db: Session, switch_id: int) -> CiscoSwitch:
    sw = db.query(CiscoSwitch).filter(CiscoSwitch.id == switch_id).first()
    if not sw:
        raise HTTPException(status_code=404, detail="Cisco switch not found.")
    return sw


def _port_count_for_vlan(db: Session, vlan_id: int) -> int:
    access_count = (
        db.query(CiscoPortAssignment)
        .filter(
            CiscoPortAssignment.mode == "access",
            CiscoPortAssignment.access_vlan == vlan_id,
        )
        .count()
    )
    trunk_assignments = (
        db.query(CiscoPortAssignment)
        .filter(CiscoPortAssignment.mode == "trunk")
        .all()
    )
    trunk_count = 0
    for pa in trunk_assignments:
        if pa.trunk_allowed_vlans:
            try:
                if vlan_id in json.loads(pa.trunk_allowed_vlans):
                    trunk_count += 1
            except Exception:
                pass
    return access_count + trunk_count


def _pa_to_read(pa: CiscoPortAssignment) -> PortAssignmentRead:
    trunk = []
    if pa.trunk_allowed_vlans:
        try:
            trunk = json.loads(pa.trunk_allowed_vlans)
        except Exception:
            trunk = []
    return PortAssignmentRead(
        id=pa.id,
        switch_id=pa.switch_id,
        port_id=pa.port_id,
        switch_name=pa.switch_name or "",
        mode=pa.mode,
        access_vlan=pa.access_vlan,
        trunk_allowed_vlans=trunk,
        trunk_native_vlan=pa.trunk_native_vlan,
        status=pa.status,
        description=pa.description or "",
        created_at=pa.created_at,
        updated_at=pa.updated_at,
    )


def _save_port_config_snapshot(
    *,
    db: Session,
    switch_id: int,
    port_label: str,
    config_text: str,
    saved_by: Optional[str] = None,
) -> CiscoPortConfigHistory:
    entry = CiscoPortConfigHistory(
        switch_id=switch_id,
        port_label=port_label,
        config_text=config_text,
        saved_by=saved_by,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


# ═══════════════════════════════════════════════════════
# Switch CRUD
# ═══════════════════════════════════════════════════════


@router.post("/switches", response_model=SwitchRead, status_code=201)
def create_switch(
    body: SwitchCreate,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    try:
        sw = CiscoSwitch(
            name=body.name.strip(),
            host=body.host.strip(),
            ssh_port=body.ssh_port,
            telnet_port=body.telnet_port,
            protocol_preference=body.protocol_preference,
            username=body.username.strip(),
            password=body.password,
            enable_password=body.enable_password or None,
            status="inactive",
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(sw)
        db.commit()
        db.refresh(sw)
        logger.info(
            "Created switch '%s' (id=%d) by %s",
            sw.name, sw.id, current_user.username,
        )
        return sw
    except Exception as e:
        db.rollback()
        logger.error("Failed to create switch: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create switch: {str(e)}")


@router.get("/switches", response_model=SwitchListResponse)
def list_switches(
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    try:
        switches = db.query(CiscoSwitch).order_by(CiscoSwitch.id.asc()).all()
        return SwitchListResponse(switches=switches, total=len(switches))
    except Exception as e:
        logger.error("Failed to list switches: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.get("/switches/{switch_id}", response_model=SwitchRead)
def get_switch(
    switch_id: int,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    return get_switch_or_404(db, switch_id)


@router.patch("/switches/{switch_id}", response_model=SwitchRead)
def update_switch(
    switch_id: int,
    body: SwitchUpdate,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    sw = get_switch_or_404(db, switch_id)
    data = body.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(sw, field, value)
    sw.updated_at = datetime.utcnow()
    db.add(sw)
    db.commit()
    db.refresh(sw)
    return sw


@router.delete("/switches/{switch_id}", status_code=204)
def delete_switch(
    switch_id: int,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    sw = get_switch_or_404(db, switch_id)
    db.delete(sw)
    db.commit()


# ═══════════════════════════════════════════════════════
# Test Connection
# ═══════════════════════════════════════════════════════


@router.post(
    "/switches/{switch_id}/test-connection",
    response_model=TestConnectionResult,
)
def test_connection(
    switch_id: int,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    sw = get_switch_or_404(db, switch_id)
    ok, proto, msg, duration_ms = test_connection_for_switch(sw, timeout=10)

    sw.last_checked_at = datetime.utcnow()
    sw.last_response_time_ms = duration_ms
    device_info_dict = None

    if ok:
        sw.status = "active"
        sw.health_protocol_used = proto
        sw.last_error = None
        try:
            service = CiscoConnectionService(sw)
            cmd_ok, _, output, _ = service.execute_command_preference(
                "show version", timeout=20
            )
            if cmd_ok and output:
                info = parse_show_version(output)
                sw.device_hostname = info.get("hostname")
                sw.device_model = info.get("model")
                sw.ios_version = info.get("ios_version")
                sw.serial_number = info.get("serial_number")
                device_info_dict = {
                    "hostname": sw.device_hostname,
                    "model": sw.device_model,
                    "ios_version": sw.ios_version,
                    "serial_number": sw.serial_number,
                }
        except Exception as e:
            logger.warning("Could not fetch device info: %s", e)
    else:
        sw.status = "error"
        sw.health_protocol_used = None
        sw.last_error = msg

    db.add(sw)
    db.commit()
    db.refresh(sw)

    return TestConnectionResult(
        success=ok,
        protocol_used=proto,
        status=sw.status,
        message=msg,
        response_time_ms=duration_ms,
        last_error=sw.last_error,
        device_info=device_info_dict,
    )


# ═══════════════════════════════════════════════════════
# Execute Command
#
# Special handling for interface shutdown / no shutdown:
# We detect the pattern and route through _ssh_config_commands
# so the session properly enters "conf t" before the interface block.
# ═══════════════════════════════════════════════════════

_IFACE_SHUTDOWN_RE = re.compile(
    r"^\s*interface\s+\S+.*\n\s*(no\s+shutdown|shutdown)\b",
    re.IGNORECASE | re.MULTILINE,
)


def _is_interface_shutdown_command(command: str) -> bool:
    """Return True when the command block is an interface up/down operation."""
    return bool(_IFACE_SHUTDOWN_RE.search(command))


def _parse_interface_shutdown_commands(command: str) -> list[str]:
    """
    Extract the individual IOS config lines from the raw command string.
    E.g.:
        "interface GigabitEthernet1/0/10\n no shutdown\n end"
    Returns:
        ["interface GigabitEthernet1/0/10", "no shutdown"]
    (We deliberately exclude "end" — _ssh_config_commands appends it.)
    """
    lines = []
    for line in command.splitlines():
        stripped = line.strip()
        if stripped.lower() == "end":
            continue          # _ssh_config_commands sends 'end' itself
        if stripped:
            lines.append(stripped)
    return lines


@router.post("/switches/{switch_id}/execute", response_model=CommandResponse)
def execute_command(
    switch_id: int,
    body: CommandRequest,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    sw = get_switch_or_404(db, switch_id)
    raw_command = body.command.strip()
    if not raw_command:
        raise HTTPException(status_code=400, detail="Command must not be empty.")

    service = CiscoConnectionService(sw)
    start = _time.time()

    # ── Route interface shutdown/no-shutdown through _ssh_config_commands ──
    if _is_interface_shutdown_command(raw_command):
        config_lines = _parse_interface_shutdown_commands(raw_command)
        logger.info(
            "[EXECUTE] Detected interface shutdown/no-shutdown — "
            "routing through _ssh_config_commands: %s",
            config_lines,
        )

        # Build a human-readable trace of what we're about to do so the
        # frontend output modal shows the full session flow.
        session_trace_header = (
            "--- Session flow ---\n"
            "  [1] connect to switch\n"
            "  [2] enable\n"
            "  [3] terminal length 0\n"
            "  [4] conf t          ← entering config mode\n"
            + "".join(f"  [5] {ln}\n" for ln in config_lines)
            + "  [6] end\n"
            "--- Executing … ---\n\n"
        )

        ok, raw_output, err = service._ssh_config_commands(config_lines, timeout=30)

        elapsed = round((_time.time() - start) * 1000, 1)

        if ok:
            full_output = session_trace_header + raw_output
            return CommandResponse(
                success=True,
                command=raw_command,
                output=full_output,
                error=None,
                protocol_used="ssh",
                execution_time_ms=elapsed,
            )
        else:
            # Try Telnet fallback if SSH-cfg failed and preference allows it
            if sw.protocol_preference != "ssh":
                logger.info(
                    "[EXECUTE] _ssh_config_commands failed, trying Telnet fallback…"
                )
                script_lines = ["conf t"] + config_lines + ["end"]
                script = "\n".join(script_lines)
                tel_ok, tel_out, tel_err = service.execute_telnet_command(
                    script, enable=True, timeout=30
                )
                elapsed = round((_time.time() - start) * 1000, 1)
                if tel_ok:
                    full_output = (
                        session_trace_header
                        + "[fallback] Used Telnet after SSH failed.\n\n"
                        + tel_out
                    )
                    return CommandResponse(
                        success=True,
                        command=raw_command,
                        output=full_output,
                        error=None,
                        protocol_used="telnet",
                        execution_time_ms=elapsed,
                    )
                combined_err = f"SSH error: {err}\nTelnet error: {tel_err}"
                return CommandResponse(
                    success=False,
                    command=raw_command,
                    output=session_trace_header,
                    error=combined_err,
                    protocol_used=None,
                    execution_time_ms=elapsed,
                )

            return CommandResponse(
                success=False,
                command=raw_command,
                output=session_trace_header,
                error=err,
                protocol_used=None,
                execution_time_ms=elapsed,
            )

    # ── All other commands — use the existing strategy ──────────────────────
    ok, proto, output, error = service.execute_command_preference(
        command=raw_command,
        enable=body.enable_mode,
        timeout=30,
    )
    elapsed = round((_time.time() - start) * 1000, 1)
    return CommandResponse(
        success=ok,
        command=raw_command,
        output=output if ok else None,
        error=error if not ok else None,
        protocol_used=proto,
        execution_time_ms=elapsed,
    )


# ═══════════════════════════════════════════════════════
# Device Info
# ═══════════════════════════════════════════════════════


@router.get(
    "/switches/{switch_id}/device-info",
    response_model=DeviceInfoResponse,
)
def get_device_info(
    switch_id: int,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    sw = get_switch_or_404(db, switch_id)
    service = CiscoConnectionService(sw)
    try:
        ok, proto, output, error = service.execute_command_preference(
            "show version", timeout=20
        )
    except Exception as e:
        return DeviceInfoResponse(success=False, error=f"{type(e).__name__}: {e}")
    if not ok:
        return DeviceInfoResponse(success=False, protocol_used=proto, error=error)
    info = parse_show_version(output)
    return DeviceInfoResponse(
        success=True,
        hostname=info.get("hostname"),
        model=info.get("model"),
        ios_version=info.get("ios_version"),
        serial_number=info.get("serial_number"),
        uptime=info.get("uptime"),
        raw_output=output,
        protocol_used=proto,
    )


# ═══════════════════════════════════════════════════════
# Sync Interfaces
# ═══════════════════════════════════════════════════════


@router.post(
    "/switches/{switch_id}/sync-interfaces",
    response_model=InterfacesResponse,
)
def sync_interfaces(
    switch_id: int,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    sw = get_switch_or_404(db, switch_id)
    service = CiscoConnectionService(sw)
    try:
        ok, proto, output, error = service.execute_command_preference(
            "show ip interface brief", timeout=20
        )
    except Exception as e:
        return InterfacesResponse(success=False, error=f"{type(e).__name__}: {e}")
    if not ok:
        return InterfacesResponse(success=False, protocol_used=proto, error=error)

    raw = parse_interfaces(output)
    now = datetime.utcnow()

    try:
        for iface_data in raw:
            snapshot = (
                db.query(CiscoInterfaceSnapshot)
                .filter(
                    CiscoInterfaceSnapshot.switch_id == switch_id,
                    CiscoInterfaceSnapshot.name == iface_data["name"],
                )
                .first()
            )
            if snapshot:
                snapshot.status = iface_data["status"]
                snapshot.protocol = iface_data["protocol"]
                snapshot.ip_address = iface_data.get("ip_address")
                snapshot.last_seen_at = now
            else:
                snapshot = CiscoInterfaceSnapshot(
                    switch_id=switch_id,
                    name=iface_data["name"],
                    status=iface_data["status"],
                    protocol=iface_data["protocol"],
                    ip_address=iface_data.get("ip_address"),
                    last_seen_at=now,
                    created_at=now,
                )
                db.add(snapshot)
        sw.cached_interfaces = json.dumps(raw)
        sw.cache_updated_at = now
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error("Failed to sync interfaces: %s", e, exc_info=True)
        return InterfacesResponse(success=False, error=f"Failed to sync: {str(e)}")

    interfaces = [InterfaceInfo(**i) for i in raw]
    return InterfacesResponse(
        success=True,
        interfaces=interfaces,
        total=len(interfaces),
        protocol_used=proto,
        cached_at=now,
    )


# ═══════════════════════════════════════════════════════
# Interfaces DB (paginated)
# ═══════════════════════════════════════════════════════


@router.get(
    "/switches/{switch_id}/interfaces-db",
    response_model=InterfacesPageResponse,
)
def get_interfaces_db(
    switch_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    search: str = Query("", max_length=200),
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    get_switch_or_404(db, switch_id)

    q = db.query(CiscoInterfaceSnapshot).filter(
        CiscoInterfaceSnapshot.switch_id == switch_id
    )
    if search.strip():
        term = f"%{search.strip()}%"
        q = q.filter(
            or_(
                CiscoInterfaceSnapshot.name.ilike(term),
                CiscoInterfaceSnapshot.status.ilike(term),
                CiscoInterfaceSnapshot.protocol.ilike(term),
                CiscoInterfaceSnapshot.ip_address.ilike(term),
            )
        )

    total = q.count()
    total_pages = ceil(total / page_size) if total > 0 else 1

    snapshots = (
        q.order_by(CiscoInterfaceSnapshot.name.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    interfaces = [
        InterfaceInfo(
            name=s.name,
            status=s.status,
            protocol=s.protocol,
            ip_address=s.ip_address,
        )
        for s in snapshots
    ]

    latest = (
        db.query(CiscoInterfaceSnapshot)
        .filter(CiscoInterfaceSnapshot.switch_id == switch_id)
        .order_by(CiscoInterfaceSnapshot.last_seen_at.desc())
        .first()
    )
    cached_at = latest.last_seen_at if latest else None

    return InterfacesPageResponse(
        success=True,
        switch_id=switch_id,
        interfaces=interfaces,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        cached_at=cached_at,
    )


# ═══════════════════════════════════════════════════════
# Sync VLANs
# ═══════════════════════════════════════════════════════


@router.post(
    "/switches/{switch_id}/sync-vlans",
    response_model=VlansResponse,
)
def sync_vlans(
    switch_id: int,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    sw = get_switch_or_404(db, switch_id)
    service = CiscoConnectionService(sw)
    try:
        ok, proto, output, error = service.execute_command_preference(
            "show vlan brief", timeout=20
        )
    except Exception as e:
        return VlansResponse(success=False, error=f"{type(e).__name__}: {e}")
    if not ok:
        return VlansResponse(success=False, protocol_used=proto, error=error)

    raw = parse_vlans(output)
    now = datetime.utcnow()

    for vlan_data in raw:
        snapshot = (
            db.query(CiscoVlanSnapshot)
            .filter(
                CiscoVlanSnapshot.switch_id == switch_id,
                CiscoVlanSnapshot.vlan_id == vlan_data["id"],
            )
            .first()
        )
        ports_json = json.dumps(vlan_data.get("ports", []))
        if snapshot:
            snapshot.name = vlan_data["name"]
            snapshot.status = vlan_data["status"]
            snapshot.ports = ports_json
            snapshot.last_seen_at = now
        else:
            snapshot = CiscoVlanSnapshot(
                switch_id=switch_id,
                vlan_id=vlan_data["id"],
                name=vlan_data["name"],
                status=vlan_data["status"],
                ports=ports_json,
                last_seen_at=now,
                created_at=now,
            )
            db.add(snapshot)

    try:
        sw.cached_vlans = json.dumps(raw)
        sw.cache_updated_at = now
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error("Failed to sync VLANs: %s", e)
        return VlansResponse(success=False, error=f"Failed to sync: {str(e)}")

    vlans = [VlanInfo(**v) for v in raw]
    return VlansResponse(
        success=True,
        vlans=vlans,
        total=len(vlans),
        protocol_used=proto,
        cached_at=sw.cache_updated_at,
    )


# ═══════════════════════════════════════════════════════
# VLANs DB (paginated)
# ═══════════════════════════════════════════════════════


@router.get(
    "/switches/{switch_id}/vlans-db",
    response_model=VlansPageResponse,
)
def get_vlans_db(
    switch_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    search: str = Query("", max_length=200),
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    get_switch_or_404(db, switch_id)

    q = db.query(CiscoVlanSnapshot).filter(
        CiscoVlanSnapshot.switch_id == switch_id
    )
    if search.strip():
        term = f"%{search.strip()}%"
        filters = [
            CiscoVlanSnapshot.name.ilike(term),
            CiscoVlanSnapshot.status.ilike(term),
        ]
        try:
            filters.append(CiscoVlanSnapshot.vlan_id == int(search.strip()))
        except ValueError:
            pass
        q = q.filter(or_(*filters))

    total = q.count()
    total_pages = ceil(total / page_size) if total > 0 else 1

    snapshots = (
        q.order_by(CiscoVlanSnapshot.vlan_id.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    vlans = []
    for s in snapshots:
        try:
            ports = json.loads(s.ports) if s.ports else []
        except Exception:
            ports = []
        vlans.append(
            VlanInfo(id=s.vlan_id, name=s.name, status=s.status, ports=ports)
        )

    latest = (
        db.query(CiscoVlanSnapshot)
        .filter(CiscoVlanSnapshot.switch_id == switch_id)
        .order_by(CiscoVlanSnapshot.last_seen_at.desc())
        .first()
    )
    cached_at = latest.last_seen_at if latest else None

    return VlansPageResponse(
        success=True,
        switch_id=switch_id,
        vlans=vlans,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        cached_at=cached_at,
    )


# ═══════════════════════════════════════════════════════
# Legacy endpoints (backward compat)
# ═══════════════════════════════════════════════════════


@router.get("/switches/{switch_id}/interfaces", response_model=InterfacesResponse)
def get_interfaces(
    switch_id: int,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    sw = get_switch_or_404(db, switch_id)
    service = CiscoConnectionService(sw)
    try:
        ok, proto, output, error = service.execute_command_preference(
            "show ip interface brief", timeout=20
        )
    except Exception as e:
        return InterfacesResponse(success=False, error=f"{type(e).__name__}: {e}")
    if not ok:
        return InterfacesResponse(success=False, protocol_used=proto, error=error)
    raw = parse_interfaces(output)
    interfaces = [InterfaceInfo(**i) for i in raw]
    try:
        sw.cached_interfaces = json.dumps(raw)
        sw.cache_updated_at = datetime.utcnow()
        db.add(sw)
        db.commit()
    except Exception:
        pass
    return InterfacesResponse(
        success=True,
        interfaces=interfaces,
        total=len(interfaces),
        protocol_used=proto,
        cached_at=sw.cache_updated_at,
    )


@router.get("/switches/{switch_id}/vlans", response_model=VlansResponse)
def get_vlans(
    switch_id: int,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    sw = get_switch_or_404(db, switch_id)
    service = CiscoConnectionService(sw)
    try:
        ok, proto, output, error = service.execute_command_preference(
            "show vlan brief", timeout=20
        )
    except Exception as e:
        return VlansResponse(success=False, error=f"{type(e).__name__}: {e}")
    if not ok:
        return VlansResponse(success=False, protocol_used=proto, error=error)
    raw = parse_vlans(output)
    vlans = [VlanInfo(**v) for v in raw]
    try:
        sw.cached_vlans = json.dumps(raw)
        sw.cache_updated_at = datetime.utcnow()
        db.add(sw)
        db.commit()
    except Exception:
        pass
    return VlansResponse(
        success=True,
        vlans=vlans,
        total=len(vlans),
        protocol_used=proto,
        cached_at=sw.cache_updated_at,
    )


# ═══════════════════════════════════════════════════════
# Port Status / Config / Lock / VLAN Change
# ═══════════════════════════════════════════════════════


@router.get(
    "/switches/{switch_id}/port-status",
    response_model=PortStatusResponse,
)
def get_port_status(
    switch_id: int,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    sw = get_switch_or_404(db, switch_id)
    service = CiscoConnectionService(sw)
    try:
        ok, proto, raw_ports, error = service.get_all_port_status(timeout=25)
    except Exception as e:
        return PortStatusResponse(
            success=False, switch_id=switch_id,
            error=f"{type(e).__name__}: {e}",
        )
    if not ok:
        return PortStatusResponse(
            success=False, switch_id=switch_id,
            protocol_used=proto, error=error,
        )
    locks = (
        db.query(CiscoPortLock)
        .filter(CiscoPortLock.switch_id == switch_id)
        .all()
    )
    locked_labels = {lock.port_label for lock in locks}
    ports = []
    for p in raw_ports:
        ports.append(
            CiscoPortInfo(
                port_label=p["port_label"],
                port_number=p.get("port_number", 0),
                description=p.get("description", ""),
                status=p["status"],
                vlan=p.get("vlan", ""),
                duplex=p.get("duplex", ""),
                speed=p.get("speed", ""),
                port_type=p.get("port_type", ""),
                mac_address=p.get("mac_address"),
                locked=p["port_label"] in locked_labels,
            )
        )
    ports.sort(key=lambda x: (x.port_label.split("/")[0], x.port_number))
    return PortStatusResponse(
        success=True,
        switch_id=switch_id,
        port_count=len(ports),
        ports=ports,
        protocol_used=proto,
    )


@router.get(
    "/switches/{switch_id}/port-config",
    response_model=PortConfigResponse,
)
def get_port_config(
    switch_id: int,
    port_label: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    sw = get_switch_or_404(db, switch_id)
    service = CiscoConnectionService(sw)
    try:
        ok, proto, output, error = service.get_port_running_config(
            port_label, timeout=15
        )
    except Exception as e:
        return PortConfigResponse(
            success=False, port_label=port_label,
            error=f"{type(e).__name__}: {e}",
        )
    if not ok:
        return PortConfigResponse(
            success=False, port_label=port_label,
            protocol_used=proto, error=error,
        )
    current_vlan = parse_running_config_vlan(output)
    return PortConfigResponse(
        success=True,
        port_label=port_label,
        config=output,
        current_vlan=current_vlan,
        protocol_used=proto,
    )


@router.post(
    "/switches/{switch_id}/ports/{port_label:path}/toggle-lock",
    response_model=PortLockToggleResponse,
)
def toggle_port_lock(
    switch_id: int,
    port_label: str,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    get_switch_or_404(db, switch_id)
    existing = (
        db.query(CiscoPortLock)
        .filter(
            CiscoPortLock.switch_id == switch_id,
            CiscoPortLock.port_label == port_label,
        )
        .first()
    )
    if existing:
        db.delete(existing)
        db.commit()
        return PortLockToggleResponse(
            success=True, port_label=port_label,
            locked=False, message=f"Port {port_label} unlocked.",
        )
    lock = CiscoPortLock(
        switch_id=switch_id,
        port_label=port_label,
        locked_by=current_user.username,
        created_at=datetime.utcnow(),
    )
    db.add(lock)
    db.commit()
    return PortLockToggleResponse(
        success=True, port_label=port_label,
        locked=True,
        message=f"Port {port_label} locked by {current_user.username}.",
    )


@router.post("/switches/{switch_id}/bulk-lock", response_model=BulkLockResponse)
def bulk_lock_ports(
    switch_id: int,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    sw = get_switch_or_404(db, switch_id)
    service = CiscoConnectionService(sw)
    ok, _, raw_ports, _ = service.get_all_port_status(timeout=25)
    if not ok:
        return BulkLockResponse(success=False, affected=0, message="Could not fetch port list.")
    existing = {
        lock.port_label
        for lock in db.query(CiscoPortLock)
        .filter(CiscoPortLock.switch_id == switch_id)
        .all()
    }
    added = 0
    for p in raw_ports:
        label = p["port_label"]
        if label not in existing:
            db.add(
                CiscoPortLock(
                    switch_id=switch_id,
                    port_label=label,
                    locked_by=current_user.username,
                    created_at=datetime.utcnow(),
                )
            )
            added += 1
    db.commit()
    return BulkLockResponse(success=True, affected=added, message=f"{added} ports locked.")


@router.post("/switches/{switch_id}/bulk-unlock", response_model=BulkLockResponse)
def bulk_unlock_ports(
    switch_id: int,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    count = (
        db.query(CiscoPortLock)
        .filter(CiscoPortLock.switch_id == switch_id)
        .delete()
    )
    db.commit()
    return BulkLockResponse(success=True, affected=count, message=f"{count} ports unlocked.")


@router.post(
    "/switches/{switch_id}/change-vlan",
    response_model=VlanChangeResponse,
)
def change_port_vlan(
    switch_id: int,
    body: VlanChangeRequest,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    sw = get_switch_or_404(db, switch_id)

    lock = (
        db.query(CiscoPortLock)
        .filter(
            CiscoPortLock.switch_id == switch_id,
            CiscoPortLock.port_label == body.port_label,
        )
        .first()
    )
    if lock:
        return VlanChangeResponse(
            success=False,
            error=f"Port {body.port_label} is locked by {lock.locked_by}.",
        )

    service = CiscoConnectionService(sw)

    try:
        cfg_ok, _, cfg_out, _ = service.get_port_running_config(
            body.port_label, timeout=15
        )
        if cfg_ok and cfg_out:
            _save_port_config_snapshot(
                db=db,
                switch_id=switch_id,
                port_label=body.port_label,
                config_text=cfg_out,
                saved_by=current_user.username,
            )
    except Exception as exc:
        logger.warning(
            "[CONFIG-HISTORY] Could not save snapshot for %s: %s",
            body.port_label, exc,
        )

    # ── Pre-change cleanup: remove stale mode config before switching ────────
    # Only runs if the port is already configured AND the mode is changing.
    # If the port has never been configured we skip silently.
    requested_mode = "trunk" if body.vlan_type.lower() == "trunk" else "access"

    try:
        cfg_ok, _, current_cfg, _ = service.get_port_running_config(
            body.port_label, timeout=15
        )
        if cfg_ok and current_cfg:
            cfg_lower = current_cfg.lower()
            current_is_trunk = "switchport mode trunk" in cfg_lower
            current_is_access = "switchport mode access" in cfg_lower

            if current_is_trunk and requested_mode == "access":
                # Trunk → Access: strip trunk settings first
                logger.info(
                    "[MODE-CHANGE] %s: trunk → access, cleaning up trunk config",
                    body.port_label,
                )
                expanded = expand_interface_name(body.port_label)
                cleanup_lines = [
                    f"interface {expanded}",
                    "no switchport trunk allowed vlan",
                    "no switchport trunk native vlan",
                    "no switchport mode trunk",
                    "switchport mode access",
                ]
                c_ok, _c_out, c_err = service._ssh_config_commands(cleanup_lines, timeout=20)
                if not c_ok:
                    logger.warning(
                        "[MODE-CHANGE] Cleanup (trunk→access) failed for %s: %s",
                        body.port_label, c_err,
                    )

            elif current_is_access and requested_mode == "trunk":
                # Access → Trunk: strip access settings first
                logger.info(
                    "[MODE-CHANGE] %s: access → trunk, cleaning up access config",
                    body.port_label,
                )
                expanded = expand_interface_name(body.port_label)
                cleanup_lines = [
                    f"interface {expanded}",
                    "no switchport access vlan",
                    "no switchport mode access",
                    "switchport mode trunk",
                ]
                c_ok, _c_out, c_err = service._ssh_config_commands(cleanup_lines, timeout=20)
                if not c_ok:
                    logger.warning(
                        "[MODE-CHANGE] Cleanup (access→trunk) failed for %s: %s",
                        body.port_label, c_err,
                    )
            # If neither flag is set the port was never explicitly configured —
            # no cleanup needed, change_vlan will configure it fresh.
    except Exception as cleanup_exc:
        logger.warning(
            "[MODE-CHANGE] Pre-change cleanup skipped for %s: %s",
            body.port_label, cleanup_exc,
        )

    try:
        ok, proto, output, error = service.change_vlan(
            port_label=body.port_label,
            new_vlan=body.new_vlan,
            vlan_type=body.vlan_type,
            description=body.description,
            timeout=30,
        )
    except Exception as exc:
        return VlanChangeResponse(
            success=False, error=f"{type(exc).__name__}: {exc}"
        )
    if not ok:
        return VlanChangeResponse(
            success=False, protocol_used=proto, error=error
        )

    if body.port_status is not None:
        try:
            status_ok, status_proto, status_out, status_err = service.apply_port_status(
                port_label=body.port_label,
                port_status=body.port_status,
                timeout=20,
            )
            if not status_ok:
                logger.warning(
                    "Port status change failed for %s: %s",
                    body.port_label, status_err,
                )
            else:
                output = (output or "") + "\n" + (status_out or "")
        except Exception as exc:
            logger.warning(
                "Could not apply port status for %s: %s",
                body.port_label, exc,
            )

    current_vlan = None
    try:
        cfg_ok, _, cfg_out, _ = service.get_port_running_config(
            body.port_label, timeout=15
        )
        if cfg_ok:
            current_vlan = parse_running_config_vlan(cfg_out)
    except Exception:
        pass

    return VlanChangeResponse(
        success=True,
        output=output,
        current_vlan=current_vlan,
        protocol_used=proto,
        error=None,
    )

# ═══════════════════════════════════════════════════════
# Sync Ports
# ═══════════════════════════════════════════════════════


@router.post(
    "/switches/{switch_id}/sync-ports",
    response_model=PortStatusResponse,
)
def sync_ports(
    switch_id: int,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    sw = get_switch_or_404(db, switch_id)
    service = CiscoConnectionService(sw)

    try:
        ok, proto, raw_ports, error = service.get_all_port_status(timeout=25)
    except Exception as e:
        return PortStatusResponse(
            success=False, switch_id=switch_id,
            error=f"{type(e).__name__}: {e}",
        )

    if not ok:
        return PortStatusResponse(
            success=False, switch_id=switch_id,
            protocol_used=proto, error=error,
        )

    locks = {
        lock.port_label
        for lock in db.query(CiscoPortLock)
        .filter(CiscoPortLock.switch_id == switch_id)
        .all()
    }

    now = datetime.utcnow()
    saved_ports = []

    for p in raw_ports:
        label = p["port_label"]
        snapshot = (
            db.query(CiscoPortSnapshot)
            .filter(
                CiscoPortSnapshot.switch_id == switch_id,
                CiscoPortSnapshot.port_label == label,
            )
            .first()
        )
        if snapshot:
            snapshot.port_number = p.get("port_number", 0)
            snapshot.description = p.get("description", "")
            snapshot.status = p["status"]
            snapshot.vlan = p.get("vlan", "")
            snapshot.duplex = p.get("duplex", "")
            snapshot.speed = p.get("speed", "")
            snapshot.port_type = p.get("port_type", "")
            snapshot.mac_address = p.get("mac_address")
            snapshot.last_seen_at = now
        else:
            snapshot = CiscoPortSnapshot(
                switch_id=switch_id,
                port_label=label,
                port_number=p.get("port_number", 0),
                description=p.get("description", ""),
                status=p["status"],
                vlan=p.get("vlan", ""),
                duplex=p.get("duplex", ""),
                speed=p.get("speed", ""),
                port_type=p.get("port_type", ""),
                mac_address=p.get("mac_address"),
                last_seen_at=now,
                created_at=now,
            )
            db.add(snapshot)

        saved_ports.append(
            CiscoPortInfo(
                port_label=label,
                port_number=p.get("port_number", 0),
                description=p.get("description", ""),
                status=p["status"],
                vlan=p.get("vlan", ""),
                duplex=p.get("duplex", ""),
                speed=p.get("speed", ""),
                port_type=p.get("port_type", ""),
                mac_address=p.get("mac_address"),
                locked=label in locks,
            )
        )

    db.commit()
    saved_ports.sort(key=lambda x: (x.port_label.split("/")[0], x.port_number))

    return PortStatusResponse(
        success=True,
        switch_id=switch_id,
        port_count=len(saved_ports),
        ports=saved_ports,
        protocol_used=proto,
    )


# ═══════════════════════════════════════════════════════
# Ports DB (paginated)
# ═══════════════════════════════════════════════════════


@router.get(
    "/switches/{switch_id}/ports-db",
    response_model=PortStatusPageResponse,
)
def get_ports_db(
    switch_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(48, ge=1, le=200),
    search: str = Query("", max_length=200),
    filter_by: str = Query("all", max_length=50),
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    get_switch_or_404(db, switch_id)

    locks = {
        lock.port_label
        for lock in db.query(CiscoPortLock)
        .filter(CiscoPortLock.switch_id == switch_id)
        .all()
    }

    q = db.query(CiscoPortSnapshot).filter(
        CiscoPortSnapshot.switch_id == switch_id
    )

    if search.strip():
        term = f"%{search.strip()}%"
        q = q.filter(
            or_(
                CiscoPortSnapshot.port_label.ilike(term),
                CiscoPortSnapshot.description.ilike(term),
                CiscoPortSnapshot.mac_address.ilike(term),
                CiscoPortSnapshot.vlan.ilike(term),
            )
        )

    if filter_by == "active":
        q = q.filter(
            or_(
                CiscoPortSnapshot.status.ilike("connected"),
                CiscoPortSnapshot.status.ilike("up"),
            )
        )
    elif filter_by == "inactive":
        q = q.filter(
            ~CiscoPortSnapshot.status.ilike("connected"),
            ~CiscoPortSnapshot.status.ilike("up"),
            ~CiscoPortSnapshot.status.ilike("%err%"),
            ~CiscoPortSnapshot.status.ilike("%disabled%"),
        )
    elif filter_by == "locked":
        if locks:
            q = q.filter(CiscoPortSnapshot.port_label.in_(locks))
        else:
            return PortStatusPageResponse(
                success=True,
                switch_id=switch_id,
                port_count=0,
                ports=[],
                page=page,
                page_size=page_size,
                total_pages=1,
                stats=PortStats(active=0, inactive=0, error=0, locked=0, unlocked=0),
            )
    elif filter_by == "unlocked":
        if locks:
            q = q.filter(~CiscoPortSnapshot.port_label.in_(locks))

    total = q.count()
    all_rows = q.all()

    active_count = inactive_count = error_count = 0
    locked_count = unlocked_count = 0

    for s in all_rows:
        sl = (s.status or "").lower()
        if sl in ("connected", "up"):
            active_count += 1
        elif "err" in sl or "disabled" in sl:
            error_count += 1
        else:
            inactive_count += 1
        if s.port_label in locks:
            locked_count += 1
        else:
            unlocked_count += 1

    PREFIX_ORDER: dict[str, int] = {
        "tengigabitethernet": 1, "te": 1,
        "gigabitethernet": 0,    "gi": 0,
        "fastethernet": 2,       "fa": 2,
        "ethernet": 3,           "et": 3,
        "vlan": 10, "loopback": 11, "tunnel": 12,
        "management": 13, "mgmt": 13,
        "port-channel": 14, "po": 14,
    }
    DEFAULT_PREFIX_ORDER = 9

    def _port_sort_key(snapshot: CiscoPortSnapshot):
        label = snapshot.port_label or ""
        match = re.match(r'^([A-Za-z\-]+)(.*)', label)
        if match:
            alpha_prefix = match.group(1).lower().rstrip("/")
            numeric_part = match.group(2).lstrip("/")
        else:
            alpha_prefix = label.lower()
            numeric_part = ""
        prefix_rank = PREFIX_ORDER.get(alpha_prefix, DEFAULT_PREFIX_ORDER)

        def _to_int(s: str) -> int:
            try:
                return int(s)
            except ValueError:
                return 0

        numeric_rank = tuple(
            _to_int(seg)
            for seg in re.split(r'[/.]', numeric_part)
            if seg != ""
        )
        return (prefix_rank, numeric_rank, label)

    all_rows.sort(key=_port_sort_key)

    total_pages = max(1, ceil(total / page_size)) if page_size > 0 else 1
    start = (page - 1) * page_size
    page_rows = all_rows[start: start + page_size]

    ports = [
        CiscoPortInfo(
            port_label=s.port_label,
            port_number=s.port_number,
            description=s.description or "",
            status=s.status,
            vlan=s.vlan or "",
            duplex=s.duplex or "",
            speed=s.speed or "",
            port_type=s.port_type or "",
            mac_address=s.mac_address,
            locked=s.port_label in locks,
        )
        for s in page_rows
    ]

    return PortStatusPageResponse(
        success=True,
        switch_id=switch_id,
        port_count=total,
        ports=ports,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        stats=PortStats(
            active=active_count,
            inactive=inactive_count,
            error=error_count,
            locked=locked_count,
            unlocked=unlocked_count,
        ),
    )


# ═══════════════════════════════════════════════════════
# Port Config History
# ═══════════════════════════════════════════════════════


@router.get(
    "/switches/{switch_id}/port-config-history/has-history",
    response_model=PortConfigHistoryHasResponse,
)
def get_ports_with_history(
    switch_id: int,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    rows = (
        db.query(CiscoPortConfigHistory.port_label)
        .filter(CiscoPortConfigHistory.switch_id == switch_id)
        .distinct()
        .all()
    )
    return PortConfigHistoryHasResponse(
        success=True,
        port_labels=[r.port_label for r in rows],
    )


@router.get(
    "/switches/{switch_id}/port-config-history",
    response_model=PortConfigHistoryResponse,
)
def get_port_config_history(
    switch_id: int,
    port_label: str = Query(..., description="Port label, e.g. GigabitEthernet0/1"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(10, ge=1, le=50, description="Items per page"),
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    get_switch_or_404(db, switch_id)

    base_q = (
        db.query(CiscoPortConfigHistory)
        .filter(
            CiscoPortConfigHistory.switch_id == switch_id,
            CiscoPortConfigHistory.port_label == port_label,
        )
    )

    total = base_q.count()
    total_pages = max(1, ceil(total / page_size))

    rows = (
        base_q
        .order_by(CiscoPortConfigHistory.saved_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return PortConfigHistoryResponse(
        success=True,
        history=[PortConfigHistoryRead.model_validate(r) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


# ═══════════════════════════════════════════════════════
# VLAN Management — Stats
# ═══════════════════════════════════════════════════════


@router.get("/vlan-management/stats", response_model=VlanMgmtStatsResponse)
def vlan_mgmt_stats(
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    total = db.query(CiscoVlan).count()
    active = db.query(CiscoVlan).filter(CiscoVlan.status == "active").count()
    access = (
        db.query(CiscoPortAssignment)
        .filter(CiscoPortAssignment.mode == "access")
        .count()
    )
    trunk = (
        db.query(CiscoPortAssignment)
        .filter(CiscoPortAssignment.mode == "trunk")
        .count()
    )
    return VlanMgmtStatsResponse(
        total_vlans=total, active_vlans=active,
        access_ports=access, trunk_ports=trunk,
    )


# ═══════════════════════════════════════════════════════
# VLAN Management — VLAN CRUD
# ═══════════════════════════════════════════════════════


@router.get("/vlan-management/vlans", response_model=VlanMgmtListResponse)
def vlan_mgmt_list_vlans(
    search: str = Query("", max_length=100),
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    q = db.query(CiscoVlan)
    if search.strip():
        term = f"%{search.strip()}%"
        filters = [CiscoVlan.name.ilike(term)]
        try:
            filters.append(CiscoVlan.vlan_id == int(search.strip()))
        except ValueError:
            pass
        q = q.filter(or_(*filters))
    rows = q.order_by(CiscoVlan.vlan_id.asc()).all()
    vlans = [
        VlanMgmtRead(
            id=r.id, vlan_id=r.vlan_id, name=r.name, status=r.status,
            port_count=_port_count_for_vlan(db, r.vlan_id),
            created_at=r.created_at, updated_at=r.updated_at,
        )
        for r in rows
    ]
    return VlanMgmtListResponse(success=True, vlans=vlans, total=len(vlans))


@router.get("/vlan-management/vlans/all", response_model=VlanMgmtListResponse)
def vlan_mgmt_list_all_vlans(
    search: str = Query("", max_length=100),
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    q = db.query(CiscoVlan)
    if search.strip():
        term = f"%{search.strip()}%"
        filters = [CiscoVlan.name.ilike(term)]
        try:
            filters.append(CiscoVlan.vlan_id == int(search.strip()))
        except ValueError:
            pass
        q = q.filter(or_(*filters))
    rows = q.order_by(CiscoVlan.vlan_id.asc()).all()
    vlans = [
        VlanMgmtRead(
            id=r.id, vlan_id=r.vlan_id, name=r.name, status=r.status,
            port_count=_port_count_for_vlan(db, r.vlan_id),
            created_at=r.created_at, updated_at=r.updated_at,
        )
        for r in rows
    ]
    return VlanMgmtListResponse(success=True, vlans=vlans, total=len(vlans))


@router.post("/vlan-management/vlans", response_model=VlanMgmtRead, status_code=201)
def vlan_mgmt_create_vlan(
    body: VlanMgmtCreate,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    existing = db.query(CiscoVlan).filter(CiscoVlan.vlan_id == body.vlan_id).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"VLAN {body.vlan_id} already exists.")
    
    now = datetime.utcnow()
    vlan = CiscoVlan(
        vlan_id=body.vlan_id, name=body.name.strip(),
        status="active", created_at=now, updated_at=now,
    )
    db.add(vlan)

    switches = db.query(CiscoSwitch).all()
    push_errors = []

    for sw in switches:
        # ── Push VLAN to the actual switch ──────────────────────────
        try:
            service = CiscoConnectionService(sw)
            commands = [
                f"vlan {body.vlan_id}",
                f"name {body.name.strip()}",
                "exit",
            ]
            ok, out, err = service._ssh_config_commands(commands, timeout=20)
            if not ok:
                logger.warning(
                    "[VLAN-CREATE] Failed to push VLAN %d to switch '%s': %s",
                    body.vlan_id, sw.name, err,
                )
                push_errors.append(sw.name)
        except Exception as exc:
            logger.warning(
                "[VLAN-CREATE] Error pushing VLAN %d to switch '%s': %s",
                body.vlan_id, sw.name, exc,
            )
            push_errors.append(sw.name)

        # ── Update DB snapshot regardless ───────────────────────────
        snapshot = (
            db.query(CiscoVlanSnapshot)
            .filter(
                CiscoVlanSnapshot.switch_id == sw.id,
                CiscoVlanSnapshot.vlan_id == body.vlan_id,
            )
            .first()
        )
        if snapshot:
            snapshot.name = body.name.strip()
            snapshot.status = "active"
            snapshot.last_seen_at = now
        else:
            db.add(CiscoVlanSnapshot(
                switch_id=sw.id, vlan_id=body.vlan_id,
                name=body.name.strip(), status="active",
                ports="[]", last_seen_at=now, created_at=now,
            ))

    db.commit()
    db.refresh(vlan)

    if push_errors:
        logger.warning(
            "[VLAN-CREATE] VLAN %d saved to DB but failed to push to: %s",
            body.vlan_id, ", ".join(push_errors),
        )

    return VlanMgmtRead(
        id=vlan.id, vlan_id=vlan.vlan_id, name=vlan.name,
        status=vlan.status, port_count=0,
        created_at=vlan.created_at, updated_at=vlan.updated_at,
    )

@router.delete(
    "/vlan-management/vlans/{vlan_db_id}",
    response_model=VlanMgmtDeleteResponse,
)
def vlan_mgmt_delete_vlan(
    vlan_db_id: int,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    vlan = db.query(CiscoVlan).filter(CiscoVlan.id == vlan_db_id).first()
    if not vlan:
        raise HTTPException(status_code=404, detail="VLAN not found.")
    if vlan.vlan_id == 1:
        raise HTTPException(
            status_code=400, detail="Cannot delete the default VLAN (1)."
        )

    vid = vlan.vlan_id
    affected = 0

    rows = (
        db.query(CiscoPortAssignment)
        .filter(
            CiscoPortAssignment.mode == "access",
            CiscoPortAssignment.access_vlan == vid,
        )
        .all()
    )
    for pa in rows:
        pa.access_vlan = 1
        pa.updated_at = datetime.utcnow()
        affected += 1

    for pa in db.query(CiscoPortAssignment).filter(CiscoPortAssignment.mode == "trunk").all():
        changed = False
        if pa.trunk_native_vlan == vid:
            pa.trunk_native_vlan = 1
            changed = True
        if pa.trunk_allowed_vlans:
            try:
                allowed = json.loads(pa.trunk_allowed_vlans)
                if vid in allowed:
                    allowed.remove(vid)
                    pa.trunk_allowed_vlans = json.dumps(allowed)
                    changed = True
            except Exception:
                pass
        if changed:
            pa.updated_at = datetime.utcnow()
            affected += 1

    db.delete(vlan)
    db.commit()
    return VlanMgmtDeleteResponse(
        success=True, message=f"VLAN {vid} deleted.", affected_ports=affected,
    )


# ═══════════════════════════════════════════════════════
# VLAN Management — Port Assignments
# ═══════════════════════════════════════════════════════


@router.get(
    "/vlan-management/ports",
    response_model=PortAssignmentListResponse,
)
def vlan_mgmt_list_ports(
    search: str = Query("", max_length=100),
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    q = db.query(CiscoPortAssignment)
    if search.strip():
        term = f"%{search.strip()}%"
        q = q.filter(
            or_(
                CiscoPortAssignment.port_id.ilike(term),
                CiscoPortAssignment.switch_name.ilike(term),
                CiscoPortAssignment.description.ilike(term),
            )
        )
    rows = (
        q.order_by(
            CiscoPortAssignment.switch_name.asc(),
            CiscoPortAssignment.port_id.asc(),
        )
        .all()
    )
    return PortAssignmentListResponse(
        success=True, ports=[_pa_to_read(r) for r in rows], total=len(rows)
    )


@router.post(
    "/vlan-management/ports",
    response_model=PortAssignmentRead,
    status_code=201,
)
def vlan_mgmt_create_port(
    body: PortAssignmentCreate,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    sw = get_switch_or_404(db, body.switch_id)
    existing = (
        db.query(CiscoPortAssignment)
        .filter(
            CiscoPortAssignment.switch_id == body.switch_id,
            CiscoPortAssignment.port_id == body.port_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Port {body.port_id} already assigned on switch {sw.name}.",
        )
    now = datetime.utcnow()
    pa = CiscoPortAssignment(
        switch_id=body.switch_id,
        port_id=body.port_id.strip(),
        switch_name=sw.name,
        mode=body.mode,
        access_vlan=body.access_vlan if body.mode == "access" else 1,
        trunk_allowed_vlans=(
            json.dumps(body.trunk_allowed_vlans) if body.mode == "trunk" else "[]"
        ),
        trunk_native_vlan=body.trunk_native_vlan if body.mode == "trunk" else 1,
        status=body.status,
        description=body.description.strip(),
        created_at=now,
        updated_at=now,
    )
    db.add(pa)
    db.commit()
    db.refresh(pa)
    return _pa_to_read(pa)


@router.put(
    "/vlan-management/ports/{port_db_id}",
    response_model=PortAssignmentRead,
)
def vlan_mgmt_update_port(
    port_db_id: int,
    body: PortAssignmentUpdate,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    pa = (
        db.query(CiscoPortAssignment)
        .filter(CiscoPortAssignment.id == port_db_id)
        .first()
    )
    if not pa:
        raise HTTPException(status_code=404, detail="Port assignment not found.")

    pa.mode = body.mode
    if body.mode == "access":
        pa.access_vlan = body.access_vlan if body.access_vlan is not None else 1
        pa.trunk_allowed_vlans = "[]"
        pa.trunk_native_vlan = 1
    else:
        pa.access_vlan = 1
        pa.trunk_allowed_vlans = json.dumps(body.trunk_allowed_vlans or [])
        pa.trunk_native_vlan = body.trunk_native_vlan if body.trunk_native_vlan is not None else 1

    pa.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(pa)
    return _pa_to_read(pa)


# ═══════════════════════════════════════════════════════
# Switch VLANs (merged snapshot + management)
# ═══════════════════════════════════════════════════════


@router.get(
    "/switches/{switch_id}/vlans-all",
    response_model=VlanMgmtListResponse,
)
def get_switch_all_vlans(
    switch_id: int,
    search: str = Query("", max_length=100),
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    get_switch_or_404(db, switch_id)

    snap_q = db.query(CiscoVlanSnapshot).filter(
        CiscoVlanSnapshot.switch_id == switch_id
    )
    if search.strip():
        term = f"%{search.strip()}%"
        snap_filters = [
            CiscoVlanSnapshot.name.ilike(term),
            CiscoVlanSnapshot.status.ilike(term),
        ]
        try:
            snap_filters.append(CiscoVlanSnapshot.vlan_id == int(search.strip()))
        except ValueError:
            pass
        snap_q = snap_q.filter(or_(*snap_filters))

    snapshots = snap_q.order_by(CiscoVlanSnapshot.vlan_id.asc()).all()

    total_snapshots_for_switch = (
        db.query(CiscoVlanSnapshot)
        .filter(CiscoVlanSnapshot.switch_id == switch_id)
        .count()
    )
    has_snapshot_vlans = total_snapshots_for_switch > 0

    seen_vlan_ids: set[int] = set()
    vlans: list[VlanMgmtRead] = []

    for s in snapshots:
        seen_vlan_ids.add(s.vlan_id)
        vlans.append(
            VlanMgmtRead(
                id=s.vlan_id, vlan_id=s.vlan_id, name=s.name, status=s.status,
                port_count=_port_count_for_vlan(db, s.vlan_id),
                created_at=s.created_at, updated_at=s.last_seen_at,
            )
        )

    mgmt_q = db.query(CiscoVlan)
    if search.strip():
        term = f"%{search.strip()}%"
        mgmt_filters = [CiscoVlan.name.ilike(term)]
        try:
            mgmt_filters.append(CiscoVlan.vlan_id == int(search.strip()))
        except ValueError:
            pass
        mgmt_q = mgmt_q.filter(or_(*mgmt_filters))

    for v in mgmt_q.order_by(CiscoVlan.vlan_id.asc()).all():
        if v.vlan_id in seen_vlan_ids:
            continue
        vlans.append(
            VlanMgmtRead(
                id=v.id, vlan_id=v.vlan_id, name=v.name, status=v.status,
                port_count=_port_count_for_vlan(db, v.vlan_id),
                created_at=v.created_at, updated_at=v.updated_at,
            )
        )

    vlans.sort(key=lambda x: x.vlan_id)
    return VlanMgmtListResponse(
        success=True, vlans=vlans, total=len(vlans),
        has_snapshot_vlans=has_snapshot_vlans,
    )


# ═══════════════════════════════════════════════════════
# Overview
# ═══════════════════════════════════════════════════════


@router.get("/overview", response_model=OverviewResponse)
def get_overview(
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    switches = db.query(CiscoSwitch).order_by(CiscoSwitch.id.asc()).all()

    total_switches = len(switches)
    active_switches = sum(1 for s in switches if s.status == "active")
    error_switches = sum(1 for s in switches if s.status == "error")
    inactive_switches = sum(1 for s in switches if s.status == "inactive")

    response_times = [
        s.last_response_time_ms
        for s in switches
        if s.last_response_time_ms is not None and s.last_response_time_ms > 0
    ]
    avg_response_time = (
        round(sum(response_times) / len(response_times), 1)
        if response_times else None
    )

    proto_counts: dict[str, int] = {}
    for sw in switches:
        proto = sw.health_protocol_used or "none"
        proto_counts[proto] = proto_counts.get(proto, 0) + 1

    total_vlans = db.query(CiscoVlan).count()
    active_vlans = db.query(CiscoVlan).filter(CiscoVlan.status == "active").count()
    access_ports = (
        db.query(CiscoPortAssignment)
        .filter(CiscoPortAssignment.mode == "access")
        .count()
    )
    trunk_ports = (
        db.query(CiscoPortAssignment)
        .filter(CiscoPortAssignment.mode == "trunk")
        .count()
    )

    all_snapshots = db.query(CiscoPortSnapshot).all()
    total_ports = len(all_snapshots)
    connected_ports = sum(
        1 for p in all_snapshots
        if (p.status or "").lower() in ("connected", "up")
    )
    locked_labels = {
        lock.port_label for lock in db.query(CiscoPortLock).all()
    }
    locked_ports = sum(
        1 for p in all_snapshots if p.port_label in locked_labels
    )

    switch_summaries = []
    for sw in switches:
        sw_snapshots = (
            db.query(CiscoPortSnapshot)
            .filter(CiscoPortSnapshot.switch_id == sw.id)
            .all()
        )
        sw_total = len(sw_snapshots)
        sw_connected = sum(
            1 for p in sw_snapshots
            if (p.status or "").lower() in ("connected", "up")
        )
        sw_locked = sum(
            1 for p in sw_snapshots if p.port_label in locked_labels
        )
        sw_vlan_count = (
            db.query(CiscoVlanSnapshot)
            .filter(CiscoVlanSnapshot.switch_id == sw.id)
            .count()
        )
        sw_iface_count = (
            db.query(CiscoInterfaceSnapshot)
            .filter(CiscoInterfaceSnapshot.switch_id == sw.id)
            .count()
        )
        switch_summaries.append(
            SwitchOverviewSummary(
                id=sw.id, name=sw.name, host=sw.host, status=sw.status,
                protocol_preference=sw.protocol_preference,
                health_protocol_used=sw.health_protocol_used,
                last_error=sw.last_error,
                last_checked_at=sw.last_checked_at,
                last_response_time_ms=sw.last_response_time_ms,
                device_hostname=sw.device_hostname,
                device_model=sw.device_model,
                ios_version=sw.ios_version,
                serial_number=sw.serial_number,
                cache_updated_at=sw.cache_updated_at,
                port_total=sw_total,
                port_connected=sw_connected,
                port_locked=sw_locked,
                vlan_count=sw_vlan_count,
                interface_count=sw_iface_count,
            )
        )

    recently_checked = sorted(
        [s for s in switch_summaries if s.last_checked_at is not None],
        key=lambda s: s.last_checked_at,  # type: ignore[arg-type]
        reverse=True,
    )[:5]

    return OverviewResponse(
        total_switches=total_switches,
        active_switches=active_switches,
        error_switches=error_switches,
        inactive_switches=inactive_switches,
        avg_response_time_ms=avg_response_time,
        protocol_distribution=proto_counts,
        total_vlans=total_vlans,
        active_vlans=active_vlans,
        access_ports=access_ports,
        trunk_ports=trunk_ports,
        total_ports=total_ports,
        connected_ports=connected_ports,
        locked_ports=locked_ports,
        switches=switch_summaries,
        recently_checked=recently_checked,
    )


@router.get(
    "/switches/{switch_id}/port-config-db",
    response_model=PortConfigResponse,
)
def get_port_config_db(
    switch_id: int,
    port_label: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    get_switch_or_404(db, switch_id)

    row = (
        db.query(CiscoPortConfigHistory)
        .filter(
            CiscoPortConfigHistory.switch_id == switch_id,
            CiscoPortConfigHistory.port_label == port_label,
        )
        .order_by(CiscoPortConfigHistory.saved_at.desc())
        .first()
    )

    if not row:
        return PortConfigResponse(
            success=False,
            port_label=port_label,
            error=(
                "No config snapshot found in the database for this port. "
                "A snapshot is saved automatically the first time you apply "
                "a configuration change to this port."
            ),
        )

    return PortConfigResponse(
        success=True,
        port_label=port_label,
        config=row.config_text,
    )