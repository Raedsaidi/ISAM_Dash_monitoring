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