# app/routes/cisco_routes.py

"""
REST endpoints for Cisco switch management.
"""

import json
import logging
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
    # VLAN-Management
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
)
from app.services.cisco_client import (
    CiscoConnectionService,
    test_connection_for_switch,
    parse_show_version,
    parse_interfaces,
    parse_vlans,
    parse_running_config_vlan,
)

router = APIRouter(prefix="/cisco", tags=["Cisco"])
logger = logging.getLogger(__name__)


# ──────────── Helpers ────────────


def get_switch_or_404(db: Session, switch_id: int) -> CiscoSwitch:
    sw = db.query(CiscoSwitch).filter(CiscoSwitch.id == switch_id).first()
    if not sw:
        raise HTTPException(
            status_code=404, detail="Cisco switch not found."
        )
    return sw


def _port_count_for_vlan(db: Session, vlan_id: int) -> int:
    """Count how many port assignments reference this VLAN."""
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
            sw.name,
            sw.id,
            current_user.username,
        )
        return sw
    except Exception as e:
        db.rollback()
        logger.error("Failed to create switch: %s", e, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create switch: {str(e)}",
        )


@router.get("/switches", response_model=SwitchListResponse)
def list_switches(
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    try:
        switches = (
            db.query(CiscoSwitch).order_by(CiscoSwitch.id.asc()).all()
        )
        return SwitchListResponse(
            switches=switches, total=len(switches)
        )
    except Exception as e:
        logger.error("Failed to list switches: %s", e, exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Database error: {str(e)}"
        )


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
    return


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
    ok, proto, msg, duration_ms = test_connection_for_switch(
        sw, timeout=10
    )

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
# ═══════════════════════════════════════════════════════


@router.post(
    "/switches/{switch_id}/execute", response_model=CommandResponse
)
def execute_command(
    switch_id: int,
    body: CommandRequest,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    sw = get_switch_or_404(db, switch_id)
    if not body.command.strip():
        raise HTTPException(
            status_code=400, detail="Command must not be empty."
        )
    service = CiscoConnectionService(sw)
    start = _time.time()
    ok, proto, output, error = service.execute_command_preference(
        command=body.command.strip(),
        enable=body.enable_mode,
        timeout=30,
    )
    elapsed = round((_time.time() - start) * 1000, 1)
    return CommandResponse(
        success=ok,
        command=body.command.strip(),
        output=output if ok else None,
        error=error if not ok else None,
        protocol_used=proto,
        execution_time_ms=elapsed,
    )


# ═══════════════════════════════════════════════════════
# Device Info / Interfaces / VLANs - SYNC TO DB
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
        return DeviceInfoResponse(
            success=False, error=f"{type(e).__name__}: {e}"
        )
    if not ok:
        return DeviceInfoResponse(
            success=False, protocol_used=proto, error=error
        )
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


@router.post(
    "/switches/{switch_id}/sync-interfaces",
    response_model=InterfacesResponse,
)
def sync_interfaces(
    switch_id: int,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    """
    Fetch interfaces from switch, persist to cisco_interface_snapshots,
    then return the synced list.
    """
    sw = get_switch_or_404(db, switch_id)
    service = CiscoConnectionService(sw)

    try:
        ok, proto, output, error = service.execute_command_preference(
            "show ip interface brief", timeout=20
        )
    except Exception as e:
        return InterfacesResponse(
            success=False, error=f"{type(e).__name__}: {e}"
        )

    if not ok:
        return InterfacesResponse(
            success=False, protocol_used=proto, error=error
        )

    raw = parse_interfaces(output)
    now = datetime.utcnow()

    try:
        # Upsert every interface into cisco_interface_snapshots
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
                snapshot.status      = iface_data["status"]
                snapshot.protocol    = iface_data["protocol"]
                snapshot.ip_address  = iface_data.get("ip_address")
                snapshot.last_seen_at = now
            else:
                snapshot = CiscoInterfaceSnapshot(
                    switch_id    = switch_id,
                    name         = iface_data["name"],
                    status       = iface_data["status"],
                    protocol     = iface_data["protocol"],
                    ip_address   = iface_data.get("ip_address"),
                    last_seen_at = now,
                    created_at   = now,
                )
                db.add(snapshot)

        # Keep the legacy JSON cache on the switch row
        sw.cached_interfaces = json.dumps(raw)
        sw.cache_updated_at  = now
        db.commit()

    except Exception as e:
        db.rollback()
        logger.error(
            "Failed to sync interfaces to DB: %s", e, exc_info=True
        )
        return InterfacesResponse(
            success=False, error=f"Failed to sync: {str(e)}"
        )

    interfaces = [InterfaceInfo(**i) for i in raw]
    return InterfacesResponse(
        success=True,
        interfaces=interfaces,
        total=len(interfaces),
        protocol_used=proto,
        cached_at=now,
    )

@router.get(
    "/switches/{switch_id}/interfaces-db",
    response_model=InterfacesPageResponse,
)
def get_interfaces_db(
    switch_id: int,
    page: int       = Query(1,   ge=1),
    page_size: int  = Query(20,  ge=1, le=200),
    search: str     = Query("",  max_length=200),
    db: Session     = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    """
    Return paginated interfaces from cisco_interface_snapshots.
    Supports server-side search by name, status, protocol, or IP.
    Call POST /sync-interfaces first to populate the table.
    """
    get_switch_or_404(db, switch_id)

    q = db.query(CiscoInterfaceSnapshot).filter(
        CiscoInterfaceSnapshot.switch_id == switch_id
    )

    # ── Server-side search ────────────────────────────────────────
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
            name       = s.name,
            status     = s.status,
            protocol   = s.protocol,
            ip_address = s.ip_address,
        )
        for s in snapshots
    ]

    # Grab cached_at from the most-recently synced snapshot
    latest_snapshot = (
        db.query(CiscoInterfaceSnapshot)
        .filter(CiscoInterfaceSnapshot.switch_id == switch_id)
        .order_by(CiscoInterfaceSnapshot.last_seen_at.desc())
        .first()
    )
    cached_at = latest_snapshot.last_seen_at if latest_snapshot else None

    return InterfacesPageResponse(
        success     = True,
        switch_id   = switch_id,
        interfaces  = interfaces,
        total       = total,
        page        = page,
        page_size   = page_size,
        total_pages = total_pages,
        cached_at   = cached_at,
    )
@router.get(                                    # ← decorator was missing
    "/switches/{switch_id}/vlans-db",
    response_model=VlansPageResponse,
)
def get_vlans_db(
    switch_id: int,
    page: int       = Query(1,   ge=1),
    page_size: int  = Query(20,  ge=1, le=200),
    search: str     = Query("",  max_length=200),
    db: Session     = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    """
    Return paginated VLANs from the cisco_vlan_snapshots table.
    Supports server-side search by VLAN ID, name, or status.
    Call POST /sync-vlans first to populate the table.
    """
    get_switch_or_404(db, switch_id)

    q = db.query(CiscoVlanSnapshot).filter(
        CiscoVlanSnapshot.switch_id == switch_id
    )

    # ── Server-side search ────────────────────────────────────────
    if search.strip():
        term = f"%{search.strip()}%"
        filters = [
            CiscoVlanSnapshot.name.ilike(term),
            CiscoVlanSnapshot.status.ilike(term),
        ]
        # Also allow exact numeric VLAN-ID match
        try:
            filters.append(
                CiscoVlanSnapshot.vlan_id == int(search.strip())
            )
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
            VlanInfo(
                id     = s.vlan_id,
                name   = s.name,
                status = s.status,
                ports  = ports,
            )
        )

    # Grab cached_at from the most-recently synced snapshot for this switch
    latest_snapshot = (
        db.query(CiscoVlanSnapshot)
        .filter(CiscoVlanSnapshot.switch_id == switch_id)
        .order_by(CiscoVlanSnapshot.last_seen_at.desc())
        .first()
    )
    cached_at = latest_snapshot.last_seen_at if latest_snapshot else None

    return VlansPageResponse(
        success     = True,
        switch_id   = switch_id,
        vlans       = vlans,
        total       = total,
        page        = page,
        page_size   = page_size,
        total_pages = total_pages,
        cached_at   = cached_at,
    )

@router.post(
    "/switches/{switch_id}/sync-vlans",
    response_model=VlansResponse,
)
def sync_vlans(
    switch_id: int,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    """
    Fetch VLANs from switch and sync to DB.
    """
    sw = get_switch_or_404(db, switch_id)
    service = CiscoConnectionService(sw)
    try:
        ok, proto, output, error = service.execute_command_preference(
            "show vlan brief", timeout=20
        )
    except Exception as e:
        return VlansResponse(
            success=False, error=f"{type(e).__name__}: {e}"
        )
    if not ok:
        return VlansResponse(
            success=False, protocol_used=proto, error=error
        )
    
    raw = parse_vlans(output)
    now = datetime.utcnow()
    
    # Sync to DB
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
        logger.error(f"Failed to sync VLANs: {e}")
        return VlansResponse(
            success=False, error=f"Failed to sync: {str(e)}"
        )
    
    vlans = [VlanInfo(**v) for v in raw]
    return VlansResponse(
        success=True,
        vlans=vlans,
        total=len(vlans),
        protocol_used=proto,
        cached_at=sw.cache_updated_at,
    )


def get_vlans_db(
    switch_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    search: str = Query("", max_length=200),
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    """
    Return paginated VLANs from DB snapshot with server-side search.
    """
    get_switch_or_404(db, switch_id)

    q = db.query(CiscoVlanSnapshot).filter(
        CiscoVlanSnapshot.switch_id == switch_id
    )

    if search.strip():
        term = f"%{search.strip()}%"
        # Also allow numeric VLAN ID match
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
            VlanInfo(
                id=s.vlan_id,
                name=s.name,
                status=s.status,
                ports=ports,
            )
        )

    sw = db.query(CiscoSwitch).filter(CiscoSwitch.id == switch_id).first()

    return VlansPageResponse(
        success=True,
        switch_id=switch_id,
        vlans=vlans,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=ceil(total / page_size) if total > 0 else 1,
        cached_at=sw.cache_updated_at if sw else None,
    )


# Keep old endpoints for backward compatibility (deprecated)
@router.get(
    "/switches/{switch_id}/interfaces",
    response_model=InterfacesResponse,
)
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
        return InterfacesResponse(
            success=False, error=f"{type(e).__name__}: {e}"
        )
    if not ok:
        return InterfacesResponse(
            success=False, protocol_used=proto, error=error
        )
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


@router.get(
    "/switches/{switch_id}/vlans", response_model=VlansResponse
)
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
        return VlansResponse(
            success=False, error=f"{type(e).__name__}: {e}"
        )
    if not ok:
        return VlansResponse(
            success=False, protocol_used=proto, error=error
        )
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
        ok, proto, raw_ports, error = service.get_all_port_status(
            timeout=25
        )
    except Exception as e:
        return PortStatusResponse(
            success=False,
            switch_id=switch_id,
            error=f"{type(e).__name__}: {e}",
        )
    if not ok:
        return PortStatusResponse(
            success=False,
            switch_id=switch_id,
            protocol_used=proto,
            error=error,
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
    ports.sort(
        key=lambda x: (x.port_label.split("/")[0], x.port_number)
    )
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
            success=False,
            port_label=port_label,
            error=f"{type(e).__name__}: {e}",
        )
    if not ok:
        return PortConfigResponse(
            success=False,
            port_label=port_label,
            protocol_used=proto,
            error=error,
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
            success=True,
            port_label=port_label,
            locked=False,
            message=f"Port {port_label} unlocked.",
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
        success=True,
        port_label=port_label,
        locked=True,
        message=f"Port {port_label} locked by {current_user.username}.",
    )


@router.post(
    "/switches/{switch_id}/bulk-lock",
    response_model=BulkLockResponse,
)
def bulk_lock_ports(
    switch_id: int,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    sw = get_switch_or_404(db, switch_id)
    service = CiscoConnectionService(sw)
    ok, _, raw_ports, _ = service.get_all_port_status(timeout=25)
    if not ok:
        return BulkLockResponse(
            success=False,
            affected=0,
            message="Could not fetch port list.",
        )
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
    return BulkLockResponse(
        success=True,
        affected=added,
        message=f"{added} ports locked.",
    )


@router.post(
    "/switches/{switch_id}/bulk-unlock",
    response_model=BulkLockResponse,
)
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
    return BulkLockResponse(
        success=True,
        affected=count,
        message=f"{count} ports unlocked.",
    )


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
        ok, proto, output, error = service.change_vlan(
            port_label=body.port_label,
            new_vlan=body.new_vlan,
            vlan_type=body.vlan_type,
            description=body.description,
            timeout=30,
        )
    except Exception as e:
        return VlanChangeResponse(
            success=False, error=f"{type(e).__name__}: {e}"
        )
    current_vlan = None
    if ok:
        try:
            cfg_ok, _, cfg_out, _ = service.get_port_running_config(
                body.port_label
            )
            if cfg_ok:
                current_vlan = parse_running_config_vlan(cfg_out)
        except Exception:
            pass
    return VlanChangeResponse(
        success=ok,
        output=output if ok else None,
        current_vlan=current_vlan,
        protocol_used=proto,
        error=error if not ok else None,
    )


# ═══════════════════════════════════════════════════════
# VLAN-Management — VLAN CRUD
# ═══════════════════════════════════════════════════════


@router.get(
    "/vlan-management/stats", response_model=VlanMgmtStatsResponse
)
def vlan_mgmt_stats(
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    total = db.query(CiscoVlan).count()
    active = (
        db.query(CiscoVlan)
        .filter(CiscoVlan.status == "active")
        .count()
    )
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
        total_vlans=total,
        active_vlans=active,
        access_ports=access,
        trunk_ports=trunk,
    )


@router.get(
    "/vlan-management/vlans", response_model=VlanMgmtListResponse
)
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

    vlans = []
    for r in rows:
        vlans.append(
            VlanMgmtRead(
                id=r.id,
                vlan_id=r.vlan_id,
                name=r.name,
                status=r.status,
                port_count=_port_count_for_vlan(db, r.vlan_id),
                created_at=r.created_at,
                updated_at=r.updated_at,
            )
        )

    return VlanMgmtListResponse(
        success=True, vlans=vlans, total=len(vlans)
    )


@router.post(
    "/vlan-management/vlans",
    response_model=VlanMgmtRead,
    status_code=201,
)
def vlan_mgmt_create_vlan(
    body: VlanMgmtCreate,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(require_admin),
):
    existing = (
        db.query(CiscoVlan)
        .filter(CiscoVlan.vlan_id == body.vlan_id)
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"VLAN {body.vlan_id} already exists.",
        )

    now = datetime.utcnow()
    vlan = CiscoVlan(
        vlan_id=body.vlan_id,
        name=body.name.strip(),
        status="active",
        created_at=now,
        updated_at=now,
    )
    db.add(vlan)
    db.commit()
    db.refresh(vlan)
    logger.info(
        "Created VLAN %d (%s) by %s",
        vlan.vlan_id,
        vlan.name,
        current_user.username,
    )
    return VlanMgmtRead(
        id=vlan.id,
        vlan_id=vlan.vlan_id,
        name=vlan.name,
        status=vlan.status,
        port_count=0,
        created_at=vlan.created_at,
        updated_at=vlan.updated_at,
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
    vlan = (
        db.query(CiscoVlan)
        .filter(CiscoVlan.id == vlan_db_id)
        .first()
    )
    if not vlan:
        raise HTTPException(status_code=404, detail="VLAN not found.")
    if vlan.vlan_id == 1:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete the default VLAN (1).",
        )

    vid = vlan.vlan_id
    affected = 0

    # Cascade: access ports → VLAN 1
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

    # Cascade: trunk ports
    trunk_rows = (
        db.query(CiscoPortAssignment)
        .filter(CiscoPortAssignment.mode == "trunk")
        .all()
    )
    for pa in trunk_rows:
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
    logger.info(
        "Deleted VLAN %d, affected %d ports — by %s",
        vid,
        affected,
        current_user.username,
    )
    return VlanMgmtDeleteResponse(
        success=True,
        message=f"VLAN {vid} deleted.",
        affected_ports=affected,
    )


# ═══════════════════════════════════════════════════════
# VLAN-Management — Port Assignment CRUD
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
    ports = [_pa_to_read(r) for r in rows]
    return PortAssignmentListResponse(
        success=True, ports=ports, total=len(ports)
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
            detail=(
                f"Port {body.port_id} already assigned "
                f"on switch {sw.name}."
            ),
        )

    now = datetime.utcnow()
    pa = CiscoPortAssignment(
        switch_id=body.switch_id,
        port_id=body.port_id.strip(),
        switch_name=sw.name,
        mode=body.mode,
        access_vlan=(
            body.access_vlan if body.mode == "access" else 1
        ),
        trunk_allowed_vlans=(
            json.dumps(body.trunk_allowed_vlans)
            if body.mode == "trunk"
            else "[]"
        ),
        trunk_native_vlan=(
            body.trunk_native_vlan if body.mode == "trunk" else 1
        ),
        status=body.status,
        description=body.description.strip(),
        created_at=now,
        updated_at=now,
    )
    db.add(pa)
    db.commit()
    db.refresh(pa)
    logger.info(
        "Created port assignment %s on %s by %s",
        pa.port_id,
        sw.name,
        current_user.username,
    )
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
        raise HTTPException(
            status_code=404, detail="Port assignment not found."
        )

    pa.mode = body.mode
    if body.mode == "access":
        pa.access_vlan = (
            body.access_vlan if body.access_vlan is not None else 1
        )
        pa.trunk_allowed_vlans = "[]"
        pa.trunk_native_vlan = 1
    else:
        pa.access_vlan = 1
        pa.trunk_allowed_vlans = json.dumps(
            body.trunk_allowed_vlans or []
        )
        pa.trunk_native_vlan = (
            body.trunk_native_vlan
            if body.trunk_native_vlan is not None
            else 1
        )

    pa.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(pa)
    logger.info(
        "Updated port %s (id=%d) by %s",
        pa.port_id,
        pa.id,
        current_user.username,
    )
    return _pa_to_read(pa)


@router.post(
    "/switches/{switch_id}/sync-ports",
    response_model=PortStatusResponse,
)
def sync_ports(
    switch_id: int,
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    """
    Fetch live port data from the Cisco switch and upsert it into
    cisco_port_snapshots so that the paginated DB endpoint can serve it.
    Returns the full (non-paginated) list for immediate use.
    """
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
            snapshot.port_number  = p.get("port_number", 0)
            snapshot.description  = p.get("description", "")
            snapshot.status       = p["status"]
            snapshot.vlan         = p.get("vlan", "")
            snapshot.duplex       = p.get("duplex", "")
            snapshot.speed        = p.get("speed", "")
            snapshot.port_type    = p.get("port_type", "")
            snapshot.mac_address  = p.get("mac_address")
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
 
    saved_ports.sort(
        key=lambda x: (x.port_label.split("/")[0], x.port_number)
    )
 
    logger.info(
        "Synced %d ports for switch %d (%s) by %s",
        len(saved_ports), switch_id, sw.name, current_user.username,
    )
 
    return PortStatusResponse(
        success=True,
        switch_id=switch_id,
        port_count=len(saved_ports),
        ports=saved_ports,
        protocol_used=proto,
    )
 
 
# app/routes/cisco_routes.py
# Only the get_ports_db endpoint needs changes — everything else stays identical

@router.get(
    "/switches/{switch_id}/ports-db",
    response_model=PortStatusPageResponse,
)
def get_ports_db(
    switch_id: int,
    page: int      = Query(1,    ge=1),
    page_size: int = Query(48,   ge=1, le=200),
    search: str    = Query("",   max_length=200),
    filter_by: str = Query("all", max_length=50),
    db: Session    = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    """
    Return a paginated list of ports from cisco_port_snapshots.
    Ports are grouped by interface type prefix (e.g. GigabitEthernet,
    FastEthernet, TenGigabitEthernet) and sorted numerically within
    each group — so you get Gi1…Gi48, then Fa1…Fa48, not interleaved.
    """
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

    # ── Search ────────────────────────────────────────────────────
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

    # ── Filter ────────────────────────────────────────────────────
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
            # No locked ports → return empty result but still with pagination
            return PortStatusPageResponse(
                success=True,
                switch_id=switch_id,
                port_count=0,
                ports=[],
                page=page,
                page_size=page_size,
                total_pages=1,
                stats=PortStats(
                    active=0, inactive=0, error=0,
                    locked=0, unlocked=0,
                ),
            )
    elif filter_by == "unlocked":
        if locks:
            q = q.filter(~CiscoPortSnapshot.port_label.in_(locks))

    # ── Fetch all matching rows for stats + custom sort ───────────
    total    = q.count()
    all_rows = q.all()

    # ── Stats across ALL filtered rows ────────────────────────────
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

    # ── Sort: group by interface-type prefix, then by port number ─
    #
    # Strategy:
    #   1. Extract the alphabetic prefix from port_label
    #      e.g. "GigabitEthernet1/0/3"  → prefix = "GigabitEthernet"
    #           "Gi1/0/3"               → prefix = "Gi"
    #           "FastEthernet0/1"       → prefix = "FastEthernet"
    #           "Te1/1/1"               → prefix = "Te"
    #           "Loopback0"             → prefix = "Loopback"
    #   2. Assign a canonical order to known prefixes so that
    #      GigabitEthernet / Gi come before FastEthernet / Fa, etc.
    #   3. Within the same prefix group sort by the numeric portion
    #      of port_label in natural order (1/0/1 < 1/0/2 < 1/0/10).
    #
    # This guarantees Gi1…Gi48 are consecutive, then Fa1…Fa48, etc.

    # Canonical prefix priority (lower = earlier in the list)
    PREFIX_ORDER: dict[str, int] = {
        # Ten-Gigabit variants
        "tengigabitethernet": 0,
        "te":                 0,
        # Gigabit variants
        "gigabitethernet":    1,
        "gi":                 1,
        # Fast-Ethernet variants
        "fastethernet":       2,
        "fa":                 2,
        # Ethernet
        "ethernet":           3,
        "et":                 3,
        # Management / VLAN / Loopback / Tunnel — push to the end
        "vlan":               10,
        "loopback":           11,
        "tunnel":             12,
        "management":         13,
        "mgmt":               13,
        "port-channel":       14,
        "po":                 14,
    }
    DEFAULT_PREFIX_ORDER = 9  # unknown types go between physical and virtual

    import re

    def _port_sort_key(snapshot: CiscoPortSnapshot):
        label = snapshot.port_label or ""

        # Split label into leading alpha prefix and the rest
        # e.g. "GigabitEthernet1/0/3" → ("GigabitEthernet", "1/0/3")
        #      "Gi1/0/48"             → ("Gi", "1/0/48")
        match = re.match(r'^([A-Za-z\-]+)(.*)', label)
        if match:
            alpha_prefix = match.group(1).lower().rstrip("/")
            numeric_part = match.group(2).lstrip("/")
        else:
            alpha_prefix = label.lower()
            numeric_part = ""

        prefix_rank = PREFIX_ORDER.get(alpha_prefix, DEFAULT_PREFIX_ORDER)

        # Natural-sort the numeric portion: split on "/" and "." then
        # convert each segment to int so "1/0/10" > "1/0/9"
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

    # ── Paginate over the sorted list ─────────────────────────────
    # Always return at least 1 total_page even when there are 0 rows
    total_pages = max(1, ceil(total / page_size)) if page_size > 0 else 1
    start       = (page - 1) * page_size
    page_rows   = all_rows[start: start + page_size]

    ports = [
        CiscoPortInfo(
            port_label  = s.port_label,
            port_number = s.port_number,
            description = s.description or "",
            status      = s.status,
            vlan        = s.vlan or "",
            duplex      = s.duplex or "",
            speed       = s.speed or "",
            port_type   = s.port_type or "",
            mac_address = s.mac_address,
            locked      = s.port_label in locks,
        )
        for s in page_rows
    ]

    return PortStatusPageResponse(
        success     = True,
        switch_id   = switch_id,
        port_count  = total,
        ports       = ports,
        page        = page,
        page_size   = page_size,
        total_pages = total_pages,
        stats       = PortStats(
            active   = active_count,
            inactive = inactive_count,
            error    = error_count,
            locked   = locked_count,
            unlocked = unlocked_count,
        ),
    )
@router.get(
    "/vlan-management/vlans/all",
    response_model=VlanMgmtListResponse,
)
def vlan_mgmt_list_all_vlans(
    search: str = Query("", max_length=100),
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    """Return all VLANs with optional search — used by Configure Port modal."""
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
            id=r.id,
            vlan_id=r.vlan_id,
            name=r.name,
            status=r.status,
            port_count=_port_count_for_vlan(db, r.vlan_id),
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        for r in rows
    ]
    return VlanMgmtListResponse(success=True, vlans=vlans, total=len(vlans))
# app/routes/cisco_routes.py - Add this new endpoint

@router.get(
    "/overview",
    response_model=OverviewResponse,
)
def get_overview(
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    """
    Return a fully DB-backed overview — no live switch calls.
    All data comes from what was previously synced/tested.
    """
    switches = db.query(CiscoSwitch).order_by(CiscoSwitch.id.asc()).all()

    total_switches   = len(switches)
    active_switches  = sum(1 for s in switches if s.status == "active")
    error_switches   = sum(1 for s in switches if s.status == "error")
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

    # Protocol distribution from health_protocol_used
    proto_counts: dict[str, int] = {}
    for sw in switches:
        proto = sw.health_protocol_used or "none"
        proto_counts[proto] = proto_counts.get(proto, 0) + 1

    # VLAN stats from cisco_vlans table
    total_vlans  = db.query(CiscoVlan).count()
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

    # Port summary across ALL synced snapshots
    all_snapshots = db.query(CiscoPortSnapshot).all()
    total_ports    = len(all_snapshots)
    connected_ports = sum(
        1 for p in all_snapshots
        if (p.status or "").lower() in ("connected", "up")
    )
    locked_labels = {
        lock.port_label
        for lock in db.query(CiscoPortLock).all()
    }
    locked_ports = sum(
        1 for p in all_snapshots
        if p.port_label in locked_labels
    )

    # Per-switch summary cards
    switch_summaries = []
    for sw in switches:
        # Count ports for this switch from snapshots
        sw_snapshots = db.query(CiscoPortSnapshot).filter(
            CiscoPortSnapshot.switch_id == sw.id
        ).all()
        sw_total     = len(sw_snapshots)
        sw_connected = sum(
            1 for p in sw_snapshots
            if (p.status or "").lower() in ("connected", "up")
        )
        sw_locked = sum(
            1 for p in sw_snapshots
            if p.port_label in locked_labels
        )
        # VLAN snapshot count for this switch
        sw_vlan_count = db.query(CiscoVlanSnapshot).filter(
            CiscoVlanSnapshot.switch_id == sw.id
        ).count()
        # Interface snapshot count
        sw_iface_count = db.query(CiscoInterfaceSnapshot).filter(
            CiscoInterfaceSnapshot.switch_id == sw.id
        ).count()

        switch_summaries.append(
            SwitchOverviewSummary(
                id=sw.id,
                name=sw.name,
                host=sw.host,
                status=sw.status,
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