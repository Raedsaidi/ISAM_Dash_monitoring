# app/models/cisco_schemas.py

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


# ═══════════════════════════════════════════════════════
# Switch CRUD
# ═══════════════════════════════════════════════════════

class SwitchCreate(BaseModel):
    name: str
    host: str
    ssh_port: int = 22
    telnet_port: int = 23
    protocol_preference: Literal["ssh", "telnet", "auto"] = "auto"
    username: str
    password: str
    enable_password: Optional[str] = None


class SwitchUpdate(BaseModel):
    name: Optional[str] = None
    host: Optional[str] = None
    ssh_port: Optional[int] = None
    telnet_port: Optional[int] = None
    protocol_preference: Optional[Literal["ssh", "telnet", "auto"]] = None
    username: Optional[str] = None
    password: Optional[str] = None
    enable_password: Optional[str] = None


class SwitchRead(BaseModel):
    id: int
    name: str
    host: str
    ssh_port: int
    telnet_port: int
    protocol_preference: str
    username: str
    status: str
    health_protocol_used: Optional[str] = None
    last_error: Optional[str] = None
    last_checked_at: Optional[datetime] = None
    last_response_time_ms: Optional[float] = None
    device_hostname: Optional[str] = None
    device_model: Optional[str] = None
    ios_version: Optional[str] = None
    serial_number: Optional[str] = None
    cache_updated_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class SwitchListResponse(BaseModel):
    switches: List[SwitchRead]
    total: int


# ═══════════════════════════════════════════════════════
# Test Connection
# ═══════════════════════════════════════════════════════

class TestConnectionResult(BaseModel):
    success: bool
    protocol_used: Optional[str] = None
    status: str
    message: str
    response_time_ms: Optional[float] = None
    last_error: Optional[str] = None
    device_info: Optional[Dict[str, Any]] = None


# ═══════════════════════════════════════════════════════
# Command Execution
# ═══════════════════════════════════════════════════════

class CommandRequest(BaseModel):
    command: str = Field(..., min_length=1, max_length=1000)
    enable_mode: bool = False


class CommandResponse(BaseModel):
    success: bool
    command: str
    output: Optional[str] = None
    error: Optional[str] = None
    protocol_used: Optional[str] = None
    execution_time_ms: Optional[float] = None


# ═══════════════════════════════════════════════════════
# Device Info
# ═══════════════════════════════════════════════════════

class DeviceInfoResponse(BaseModel):
    success: bool
    hostname: Optional[str] = None
    model: Optional[str] = None
    ios_version: Optional[str] = None
    serial_number: Optional[str] = None
    uptime: Optional[str] = None
    raw_output: Optional[str] = None
    protocol_used: Optional[str] = None
    error: Optional[str] = None


# ═══════════════════════════════════════════════════════
# Interfaces
# ═══════════════════════════════════════════════════════

class InterfaceInfo(BaseModel):
    name: str
    status: str
    protocol: str
    ip_address: Optional[str] = None


class InterfacesResponse(BaseModel):
    success: bool
    interfaces: List[InterfaceInfo] = []
    total: int = 0
    protocol_used: Optional[str] = None
    error: Optional[str] = None
    cached_at: Optional[datetime] = None


# ═══════════════════════════════════════════════════════
# VLANs (show vlan brief)
# ═══════════════════════════════════════════════════════

class VlanInfo(BaseModel):
    id: int
    name: str
    status: str
    ports: List[str] = []


class VlansResponse(BaseModel):
    success: bool
    vlans: List[VlanInfo] = []
    total: int = 0
    protocol_used: Optional[str] = None
    error: Optional[str] = None
    cached_at: Optional[datetime] = None


# ═══════════════════════════════════════════════════════
# Port Management
# ═══════════════════════════════════════════════════════

class CiscoPortInfo(BaseModel):
    port_label: str
    port_number: int
    description: str = ""
    status: str
    vlan: str = ""
    duplex: str = ""
    speed: str = ""
    port_type: str = ""
    mac_address: Optional[str] = None
    locked: bool = False


class PortStatusResponse(BaseModel):
    success: bool
    switch_id: int = 0
    port_count: int = 0
    ports: List[CiscoPortInfo] = []
    protocol_used: Optional[str] = None
    error: Optional[str] = None


class PortLockToggleResponse(BaseModel):
    success: bool
    port_label: str
    locked: bool
    message: str


class BulkLockResponse(BaseModel):
    success: bool
    affected: int
    message: str


class VlanChangeRequest(BaseModel):
    port_label: str
    new_vlan: str
    vlan_type: str = "Access"
    description: str = ""


class VlanChangeResponse(BaseModel):
    success: bool
    output: Optional[str] = None
    current_vlan: Optional[str] = None
    protocol_used: Optional[str] = None
    error: Optional[str] = None


class PortConfigResponse(BaseModel):
    success: bool
    port_label: str = ""
    config: Optional[str] = None
    current_vlan: Optional[str] = None
    protocol_used: Optional[str] = None
    error: Optional[str] = None


# ═══════════════════════════════════════════════════════
# VLAN-Management CRUD
# ═══════════════════════════════════════════════════════

class VlanMgmtCreate(BaseModel):
    vlan_id: int = Field(..., ge=2, le=4094)
    name: str = Field(..., min_length=1, max_length=255)


class VlanMgmtRead(BaseModel):
    id: int
    vlan_id: int
    name: str
    status: str
    port_count: int = 0
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class VlanMgmtListResponse(BaseModel):
    success: bool = True
    vlans: List[VlanMgmtRead] = []
    total: int = 0
    has_snapshot_vlans: bool = False  # ← add this field


class VlanMgmtDeleteResponse(BaseModel):
    success: bool
    message: str
    affected_ports: int = 0


# ═══════════════════════════════════════════════════════
# Port-Assignment CRUD
# ═══════════════════════════════════════════════════════

class PortAssignmentCreate(BaseModel):
    switch_id: int
    port_id: str = Field(..., min_length=1, max_length=100)
    mode: Literal["access", "trunk"] = "access"
    access_vlan: int = 1
    trunk_allowed_vlans: List[int] = []
    trunk_native_vlan: int = 1
    status: str = "up"
    description: str = ""


class PortAssignmentUpdate(BaseModel):
    mode: Literal["access", "trunk"]
    access_vlan: Optional[int] = None
    trunk_allowed_vlans: Optional[List[int]] = None
    trunk_native_vlan: Optional[int] = None


class PortAssignmentRead(BaseModel):
    id: int
    switch_id: int
    port_id: str
    switch_name: str
    mode: str
    access_vlan: int
    trunk_allowed_vlans: List[int] = []
    trunk_native_vlan: int
    status: str
    description: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class PortAssignmentListResponse(BaseModel):
    success: bool = True
    ports: List[PortAssignmentRead] = []
    total: int = 0


class VlanMgmtStatsResponse(BaseModel):
    total_vlans: int = 0
    active_vlans: int = 0
    access_ports: int = 0
    trunk_ports: int = 0


# ═══════════════════════════════════════════════════════
# Paginated responses
# ═══════════════════════════════════════════════════════

class InterfacesPageResponse(BaseModel):
    """Paginated interfaces list loaded from DB."""
    success: bool
    switch_id: int = 0
    interfaces: List[InterfaceInfo] = []
    total: int = 0
    page: int = 1
    page_size: int = 50
    total_pages: int = 1
    protocol_used: Optional[str] = None
    error: Optional[str] = None
    cached_at: Optional[datetime] = None


class VlansPageResponse(BaseModel):
    """Paginated VLANs list loaded from DB."""
    success: bool
    switch_id: int = 0
    vlans: List[VlanInfo] = []
    total: int = 0
    page: int = 1
    page_size: int = 50
    total_pages: int = 1
    protocol_used: Optional[str] = None
    error: Optional[str] = None
    cached_at: Optional[datetime] = None


# ── NEW: per-page port statistics returned by the backend ──────────

class PortStats(BaseModel):
    """
    Counts computed server-side across ALL rows matching the current
    search/filter (not just the current page).
    """
    active: int = 0
    inactive: int = 0
    error: int = 0
    locked: int = 0
    unlocked: int = 0


class PortStatusPageResponse(BaseModel):
    """Paginated port list loaded from the DB snapshot table."""
    success: bool
    switch_id: int = 0
    port_count: int = 0
    ports: List[CiscoPortInfo] = []
    protocol_used: Optional[str] = None
    error: Optional[str] = None
    page: int = 1
    page_size: int = 48
    total_pages: int = 1
    # Stats across ALL filtered rows (not just this page)
    stats: Optional[PortStats] = None
# app/models/cisco_schemas.py — append these classes

class SwitchOverviewSummary(BaseModel):
    """Per-switch row used in the overview, sourced entirely from DB."""
    id: int
    name: str
    host: str
    status: str
    protocol_preference: str
    health_protocol_used: Optional[str] = None
    last_error: Optional[str] = None
    last_checked_at: Optional[datetime] = None
    last_response_time_ms: Optional[float] = None
    device_hostname: Optional[str] = None
    device_model: Optional[str] = None
    ios_version: Optional[str] = None
    serial_number: Optional[str] = None
    cache_updated_at: Optional[datetime] = None
    # Aggregated from snapshot tables
    port_total: int = 0
    port_connected: int = 0
    port_locked: int = 0
    vlan_count: int = 0
    interface_count: int = 0

    class Config:
        from_attributes = True


class OverviewResponse(BaseModel):
    """Single endpoint that the Overview page reads from."""
    # Switch health
    total_switches: int = 0
    active_switches: int = 0
    error_switches: int = 0
    inactive_switches: int = 0
    avg_response_time_ms: Optional[float] = None
    protocol_distribution: Dict[str, int] = {}
    # VLAN management
    total_vlans: int = 0
    active_vlans: int = 0
    access_ports: int = 0
    trunk_ports: int = 0
    # Port snapshots (aggregated across all switches)
    total_ports: int = 0
    connected_ports: int = 0
    locked_ports: int = 0
    # Per-switch details
    switches: List[SwitchOverviewSummary] = []
    recently_checked: List[SwitchOverviewSummary] = []
# app/models/cisco_schemas.py
# Update VlanChangeRequest to include optional port_status field

class VlanChangeRequest(BaseModel):
    port_label:   str
    new_vlan:     str
    vlan_type:    str = "Access"
    description:  str = ""
    port_status:  Optional[str] = None   # "up" | "down" | None (leave unchanged)
# app/models/cisco_schemas.py
# Update VlanMgmtListResponse to carry the flag
# app/models/cisco_schemas.py
# Add these classes (append to existing file)

# ═══════════════════════════════════════════════════════
# Saved Config Templates
# ═══════════════════════════════════════════════════════

class ConfigArgDef(BaseModel):
    name: str
    label: str = ""
    placeholder: str = ""
    default: str = ""


class SavedConfigCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str = ""
    template: str = Field(..., min_length=1)
    args: List[ConfigArgDef] = []


class SavedConfigUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    template: Optional[str] = None
    args: Optional[List[ConfigArgDef]] = None


class SavedConfigRead(BaseModel):
    id: int
    name: str
    description: str
    template: str
    args: List[ConfigArgDef] = []
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class SavedConfigListResponse(BaseModel):
    success: bool = True
    configs: List[SavedConfigRead] = []
    total: int = 0


class SavedConfigDeleteResponse(BaseModel):
    success: bool
    message: str


class ExecuteConfigRequest(BaseModel):
    switch_id: int
    command: str = Field(..., min_length=1)


class ExecuteConfigResponse(BaseModel):
    success: bool
    output: Optional[str] = None
    error: Optional[str] = None
    protocol_used: Optional[str] = None
    execution_time_ms: Optional[float] = None

# app/models/cisco_schemas.py
# — append / update these sections in your existing file —

# ═══════════════════════════════════════════════════════
# Port Config History  (NEW)
# ═══════════════════════════════════════════════════════

class PortConfigHistoryRead(BaseModel):
    id: int
    switch_id: int
    port_label: str
    config_text: str
    saved_by: Optional[str] = None
    saved_at: datetime

    class Config:
        from_attributes = True


class PortConfigHistoryResponse(BaseModel):
    """Returned by GET /switches/{id}/port-config-history?port_label=..."""
    success: bool = True
    history: List[PortConfigHistoryRead] = []
    total: int = 0


class PortConfigHistoryHasResponse(BaseModel):
    """
    Returned by GET /switches/{id}/port-config-history/has-history
    Lists only the port_labels that have at least one history entry.
    Used by the frontend to decide which rows should show the
    'Last Config' button.
    """
    success: bool = True
    port_labels: List[str] = []
    