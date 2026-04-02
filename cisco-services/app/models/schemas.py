from pydantic import BaseModel
from typing import List, Optional


class DeviceResponse(BaseModel):
    id: str
    hostname: Optional[str] = None
    management_ip: Optional[str] = None
    platform: Optional[str] = None
    status: Optional[str] = None


class DeviceListResponse(BaseModel):
    devices: List[DeviceResponse]
    count: int