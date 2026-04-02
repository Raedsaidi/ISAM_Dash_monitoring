from fastapi import APIRouter, HTTPException, Depends
from app.models.schemas import DeviceListResponse, DeviceResponse
from app.services.cisco_client import CiscoClient

router = APIRouter()


def get_cisco_client():
    return CiscoClient()


@router.get("/devices", response_model=DeviceListResponse)
async def get_devices(client: CiscoClient = Depends(get_cisco_client)):
    devices = await client.get_devices()
    return DeviceListResponse(devices=devices, count=len(devices))


@router.get("/devices/{device_id}", response_model=DeviceResponse)
async def get_device(device_id: str, client: CiscoClient = Depends(get_cisco_client)):
    device = await client.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device