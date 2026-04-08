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
    Fetch interfaces from switch and sync to DB.
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
    
    # Sync to DB
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
    
    try:
        sw.cached_interfaces = json.dumps(raw)
        sw.cache_updated_at = now
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to sync interfaces: {e}")
        return InterfacesResponse(
            success=False, error=f"Failed to sync: {str(e)}"
        )
    
    interfaces = [InterfaceInfo(**i) for i in raw]
    return InterfacesResponse(
        success=True,
        interfaces=interfaces,
        total=len(interfaces),
        protocol_used=proto,
        cached_at=sw.cache_updated_at,
    )


@router.get(
    "/switches/{switch_id}/interfaces-db",
    response_model=InterfacesPageResponse,
)
def get_interfaces_db(
    switch_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    """
    Return paginated interfaces from DB snapshot.
    """
    get_switch_or_404(db, switch_id)
    
    total = (
        db.query(CiscoInterfaceSnapshot)
        .filter(CiscoInterfaceSnapshot.switch_id == switch_id)
        .count()
    )
    
    snapshots = (
        db.query(CiscoInterfaceSnapshot)
        .filter(CiscoInterfaceSnapshot.switch_id == switch_id)
        .order_by(CiscoInterfaceSnapshot.name.asc())
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
    
    # Get cached_at from switch
    sw = db.query(CiscoSwitch).filter(CiscoSwitch.id == switch_id).first()
    
    return InterfacesPageResponse(
        success=True,
        switch_id=switch_id,
        interfaces=interfaces,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=ceil(total / page_size) if total > 0 else 1,
        cached_at=sw.cache_updated_at if sw else None,
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


@router.get(
    "/switches/{switch_id}/vlans-db",
    response_model=VlansPageResponse,
)
def get_vlans_db(
    switch_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    """
    Return paginated VLANs from DB snapshot.
    """
    get_switch_or_404(db, switch_id)
    
    total = (
        db.query(CiscoVlanSnapshot)
        .filter(CiscoVlanSnapshot.switch_id == switch_id)
        .count()
    )
    
    snapshots = (
        db.query(CiscoVlanSnapshot)
        .filter(CiscoVlanSnapshot.switch_id == switch_id)
        .order_by(CiscoVlanSnapshot.vlan_id.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    
    vlans = []
    for s in snapshots:
        try:
            ports = json.loads(s.ports) if s.ports else []
        except:
            ports = []
        
        vlans.append(
            VlanInfo(
                id=s.vlan_id,
                name=s.name,
                status=s.status,
                ports=ports,
            )
        )
    
    # Get cached_at from switch
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
 
 
@router.get(
    "/switches/{switch_id}/ports-db",
    response_model=PortStatusPageResponse,
)
def get_ports_db(
    switch_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(48, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: TokenUser = Depends(get_current_user),
):
    """
    Return a paginated list of ports from the DB snapshot table.
    Use POST /sync-ports first to populate the table.
    """
    get_switch_or_404(db, switch_id)
 
    locks = {
        lock.port_label
        for lock in db.query(CiscoPortLock)
        .filter(CiscoPortLock.switch_id == switch_id)
        .all()
    }
 
    total = (
        db.query(CiscoPortSnapshot)
        .filter(CiscoPortSnapshot.switch_id == switch_id)
        .count()
    )
 
    snapshots = (
        db.query(CiscoPortSnapshot)
        .filter(CiscoPortSnapshot.switch_id == switch_id)
        .order_by(
            CiscoPortSnapshot.port_label.asc(),
            CiscoPortSnapshot.port_number.asc(),
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
 
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
        for s in snapshots
    ]
 
    return PortStatusPageResponse(
        success=True,
        switch_id=switch_id,
        port_count=total,
        ports=ports,
        page=page,
        page_size=page_size,
        total_pages=ceil(total / page_size) if total > 0 else 1,
    )