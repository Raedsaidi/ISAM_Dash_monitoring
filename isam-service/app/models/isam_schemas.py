from __future__ import annotations
from enum import Enum
from datetime import datetime
from typing import List, Optional, Any, Dict, Literal

from pydantic import BaseModel, Field

from app.models.isam_instance import ISAMInstance
from app.models.config_history import ConfigHistory
from app.models.wan_template import WanTemplate



# -------- ISAM Instances --------

class ISAMInstanceCreate(BaseModel):
    name: str
    host: str
    telnet_port: int
    ssh_port: int
    protocol_preference: Literal["telnet", "ssh", "auto"]
    username: str
    password: str


class ISAMInstanceUpdate(BaseModel):
    name: Optional[str] = None
    host: Optional[str] = None
    telnet_port: Optional[int] = None
    ssh_port: Optional[int] = None
    protocol_preference: Optional[Literal["telnet", "ssh", "auto"]] = None
    username: Optional[str] = None
    password: Optional[str] = None


class ISAMInstanceRead(BaseModel):
    id: int
    name: str
    host: str
    telnet_port: int
    ssh_port: int
    protocol_preference: str
    username: str
    status: str
    health_protocol_used: Optional[str] = None
    last_error: Optional[str] = None
    last_checked_at: Optional[datetime] = None
    last_response_time_ms: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ISAMInstanceList(BaseModel):
    instances: List[ISAMInstanceRead]


# -------- Test connection --------

class TestConnectionResult(BaseModel):
    success: bool
    protocol_used: Optional[str] = None
    status: str
    message: str
    response_time_ms: Optional[int] = None
    last_error: Optional[str] = None


# -------- Run Command --------

class RunCommandRequest(BaseModel):
    command: str
    override_protocol: Optional[Literal["ssh", "telnet"]] = None


class RunCommandResponse(BaseModel):
    success: bool
    protocol_used: Optional[str] = None
    stdout: Optional[str] = None
    stderr_or_message: Optional[str] = None


# -------- Ports (show port) --------

class PortItem(BaseModel):
    board: str
    port_id: str
    admin_state: str
    link_state: str
    port_state: str
    cfg_mtu: int
    oper_mtu: int
    lag_bndl: str
    mode: str
    encap: str
    port_type: str


class PortsResponse(BaseModel):
    success: bool
    protocol_used: Optional[str] = None
    port_count: int
    ports: List[PortItem]
    raw_output: str
    message: str


# -------- Memory Usage (show system memory-usage) --------

class MemoryUsageResponse(BaseModel):
    success: bool
    protocol_used: Optional[str] = None
    raw_output: str
    parsed: Dict[str, Any]
    message: str


# -------- WAN Templates --------

TemplateScope = Literal["GLOBAL", "USER_INSTANCE"]


class WanTemplateBase(BaseModel):
    name: str
    commands_template: str


class WanTemplateCreate(WanTemplateBase):
    scope: TemplateScope = "GLOBAL"
    isam_instance_id: Optional[int] = None
    source_template_id: Optional[int] = None
    project: Optional[str] = None
    saved_parameters: Optional[WanTemplateSavedParameters] = None


class WanTemplateUpdate(BaseModel):
    name: Optional[str] = None
    commands_template: Optional[str] = None
    project: Optional[str] = None
    saved_parameters: Optional[WanTemplateSavedParameters] = None


class WanTemplateRead(WanTemplateBase):
    id: int
    scope: TemplateScope
    isam_instance_id: Optional[int] = None
    created_by: Optional[str] = None
    source_template_id: Optional[int] = None
    project: Optional[str] = None
    saved_parameters: Optional[WanTemplateSavedParameters] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class WanTemplateList(BaseModel):
    templates: List[WanTemplateRead]
    # pagination meta (new)
    total: int = 0
    page: int = 1
    page_size: int = 10
    total_pages: int = 1


class ApplyWanTemplateResponse(BaseModel):
    success: bool
    protocol_used: Optional[str] = None
    commands_executed: List[str]
    raw_output: str
    message: str

class WanTemplateSavedParameters(BaseModel):
    selected_port: Optional[str] = None
    manual_port: Optional[str] = None
    effective_port: Optional[str] = None
    variables: Dict[str, str] = Field(default_factory=dict)
    saved_from: Optional[Literal["manual-edit", "apply-success"]] = None
    applied_at: Optional[datetime] = None

# -------- Template rendering / preview / test / live apply --------

class TemplateRenderRequest(BaseModel):
    commands_template: str
    selected_port: Optional[str] = None
    variables: Dict[str, str] = Field(default_factory=dict)


class TemplateRenderResponse(BaseModel):
    variables_detected: List[str]
    rendered_script: str
    rendered_commands: List[str]


class TemplateTestRequest(TemplateRenderRequest):
    instance_id: int
    template_id: Optional[int] = None
    template_name: Optional[str] = None


class TemplateTestResponse(BaseModel):
    success: bool
    protocol_used: Optional[str] = None
    rendered_commands: List[str]
    raw_output: str
    message: str


class TemplateApplyLiveRequest(TemplateRenderRequest):
    instance_id: int
    template_id: Optional[int] = None


# -------- My Port / My Templates --------

class MyPortResponse(BaseModel):
    success: bool
    instance_id: int
    port_id: Optional[str] = None
    port: Optional[PortItem] = None
    message: str


class MyApplyTemplateRequest(BaseModel):
    instance_id: int
    template_id: int


# -------- Config History --------

class ConfigHistoryRead(BaseModel):
    id: int
    username: str
    action: str
    isam_instance_id: Optional[int] = None
    port_id: Optional[str] = None
    template_id: Optional[int] = None
    success: bool
    message: Optional[str] = None
    ip_address: Optional[str] = None
    commands_executed: Optional[str] = None
    raw_output: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class ConfigHistoryList(BaseModel):
    items: List[ConfigHistoryRead]


# -------------------- isam_data.py --------------------

class CachedPortsResponse(PortsResponse):
    cached_at: Optional[datetime] = None
    last_refresh_at: Optional[datetime] = None
    last_refresh_success: bool = False
    last_refresh_error: Optional[str] = None


class CachedMemoryUsageResponse(MemoryUsageResponse):
    cached_at: Optional[datetime] = None
    last_refresh_at: Optional[datetime] = None
    last_refresh_success: bool = False
    last_refresh_error: Optional[str] = None


# ===== PORT LOCK SCHEMAS =====

class PortLockResponse(BaseModel):
    success: bool
    port_id: str
    locked: bool
    locked_by: Optional[str] = None
    locked_at: Optional[datetime] = None
    message: str


class PortLockStatusResponse(BaseModel):
    port_id: str
    locked: bool
    locked_by: Optional[str] = None
    locked_at: Optional[datetime] = None


class PortLockCreate(BaseModel):
    port_id: str
    reason: Optional[str] = None


class PortLockDelete(BaseModel):
    port_id: str


# ===== LT SLOT SCHEMAS =====

class LTSlotItem(BaseModel):
    slot_id: str
    board: str
    admin_state: str
    link_state: str
    port_state: str
    cfg_mtu: int
    oper_mtu: int
    lag_bndl: str
    mode: str
    encap: str
    port_type: str


class LTSlotsResponse(BaseModel):
    success: bool
    protocol_used: Optional[str] = None
    slot_count: int
    slots: List[LTSlotItem]
    raw_output: str
    message: str
    cached_at: Optional[datetime] = None
    last_refresh_at: Optional[datetime] = None
    last_refresh_success: bool = False
    last_refresh_error: Optional[str] = None


# ===== LT PORT SCHEMAS =====

class LTPortItem(BaseModel):
    port_id: str
    slot_id: str
    port_type: str
    admin_state: str
    link_state: str
    port_state: str
    cfg_mtu: int
    oper_mtu: int
    lag_bndl: str
    mode: str
    encap: str
    board: str
    locked: bool = False
    config: Optional[PortConfigSummary] = None


class LTPortsResponse(BaseModel):
    success: bool
    protocol_used: Optional[str] = None
    port_count: int
    total_count: Optional[int] = None
    ports: List[LTPortItem]
    slot_id: str
    raw_output: str
    message: str
    search_query: Optional[str] = None
    filters_applied: Optional[Dict[str, str]] = None
    cached_at: Optional[datetime] = None
    last_refresh_at: Optional[datetime] = None
    last_refresh_success: bool = False
    last_refresh_error: Optional[str] = None


# ===== WAN MODEL SCHEMAS (table indépendante) =====

class WanModelCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=255)


class WanModelUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=255)


class WanModelRead(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class WanModelList(BaseModel):
    models: List[WanModelRead]



# ===== TEMPLATE PROJECT SCHEMAS (table indépendante) =====

class TemplateProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=255)


class TemplateProjectUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=255)


class TemplateProjectRead(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class TemplateProjectList(BaseModel):
    projects: List[TemplateProjectRead]
class ConfigHistoryList(BaseModel):
    items: list[ConfigHistoryRead]
    total: int = 0

    class Config:
        from_attributes = True



# ===== PORT TEMPLATE STATUS =====

class PortTemplateStatusResponse(BaseModel):
    configured: bool
    port_id: str
    instance_id: int
    last_template_id: Optional[int] = None
    last_template_name: Optional[str] = None
    last_project: Optional[str] = None
    last_applied_by: Optional[str] = None
    last_applied_at: Optional[datetime] = None
    apply_count: int = 0
    message: str




# ===== CUSTOM FUNCTIONS =====

class CustomFunctionScope(str, Enum):
    GLOBAL = "GLOBAL"
    USER_INSTANCE = "USER_INSTANCE"


class CustomFunctionBase(BaseModel):
    name: str = Field(..., min_length=3, max_length=100)
    command_template: str = Field(..., min_length=1, max_length=5000)
    description: Optional[str] = Field(None, max_length=500)
    project: Optional[str] = Field(None, max_length=100)


class CustomFunctionCreate(CustomFunctionBase):
    scope: CustomFunctionScope = CustomFunctionScope.GLOBAL
    isam_instance_id: Optional[int] = None


class CustomFunctionUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=3, max_length=100)
    command_template: Optional[str] = None
    description: Optional[str] = None
    project: Optional[str] = None


class CustomFunctionRead(CustomFunctionBase):
    id: int
    scope: CustomFunctionScope
    isam_instance_id: Optional[int] = None
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CustomFunctionList(BaseModel):
    functions: List[CustomFunctionRead]
    total: int = 0
    page: int = 1
    page_size: int = 10
    total_pages: int = 1


class CustomFunctionExecuteRequest(BaseModel):
    function_id: Optional[int] = None
    command_template: Optional[str] = None
    variables: Dict[str, str] = Field(default_factory=dict)
    instance_id: int


class CustomFunctionExecuteResponse(BaseModel):
    success: bool
    protocol_used: Optional[str] = None
    executed_command: str
    raw_output: str
    variables_used: Dict[str, str]
    message: str
    function_id: Optional[int] = None
    function_name: Optional[str] = None





#--------------------- PORT CONFIG SCHEMAS --------------------
class PortConfigSummary(BaseModel):
    status: str = "UNKNOWN"
    last_device_check_at: Optional[datetime] = None
    last_device_check_success: bool = False
    last_device_check_error: Optional[str] = None

    last_template_id: Optional[int] = None
    last_template_name: Optional[str] = None
    last_project: Optional[str] = None
    last_applied_by: Optional[str] = None
    last_applied_at: Optional[datetime] = None
    apply_count: int = 0

    device_vlan_count: int = 0
    expected_vlan_count: int = 0

    ont_sernum: Optional[str] = None


class PortConfigAppLastApply(BaseModel):
    found: bool = False
    template_id: Optional[int] = None
    template_name: Optional[str] = None
    project: Optional[str] = None
    applied_by: Optional[str] = None
    applied_at: Optional[datetime] = None
    commands_executed: List[str] = []
    raw_output: Optional[str] = None


class PortConfigDeviceSnapshot(BaseModel):
    status: str = "UNKNOWN"
    last_device_check_at: Optional[datetime] = None
    last_device_check_success: bool = False
    last_device_check_error: Optional[str] = None

    device_vlan_lines: List[str] = []
    device_raw_output: Optional[str] = None
    ont_sernum: Optional[str] = None


class PortConfigDetailResponse(BaseModel):
    success: bool
    instance_id: int
    port_id: str

    app_last_apply: PortConfigAppLastApply
    device_snapshot: PortConfigDeviceSnapshot





class SFPPortRead(BaseModel):
    """Lecture d'un SFP depuis la DB."""
    sfp_id:        str
    slot_id:       str
    slot_short_id: str
    sfp_index:     int
    port_id:       str          # ex: "1/1/6/35"

    status:        str          # no-error | cage-empty | sfp-no-a2-supp
    is_empty:      bool
    is_active:     bool
    is_copper:     bool

    part_number:   Optional[str] = None
    wavelength:    Optional[str] = None
    fiber_mode:    Optional[str] = None
    standard:      Optional[str] = None

    speed:         Optional[str] = None
    direction:     Optional[str] = None
    media:         Optional[str] = None
    tx_wavelength: Optional[str] = None
    rx_wavelength: Optional[str] = None

    last_refresh_at: Optional[Any] = None

    model_config = {"from_attributes": True}


class SFPSlotSummary(BaseModel):
    total:     int
    active:    int
    empty:     int
    copper:    int
    fiber:     int
    speeds:    List[str]
    standards: List[str]


class TransceiverSlotResult(BaseModel):
    slot_short_id: str
    ok:            bool
    error:         Optional[str] = None
    sfp:           List[SFPPortRead]
    summary:       SFPSlotSummary


class TransceiverRefreshResponse(BaseModel):
    success:   bool
    protocol:  Optional[str] = None
    message:   str
    slots:     Dict[str, TransceiverSlotResult]


class TransceiverPortResponse(BaseModel):
    """Réponse pour un port_id spécifique."""
    success:       bool
    port_id:       str
    instance_id:   int
    sfp:           Optional[SFPPortRead] = None
    message:       str