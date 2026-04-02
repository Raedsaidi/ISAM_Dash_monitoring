"""
REST endpoints for Cisco switch management.
Every handler wraps its logic in try/except so errors are always reported.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.schemas import (
    SwitchCreate,
    SwitchUpdate,
    SwitchResponse,
    SwitchListResponse,
    TestConnectionResponse,
    CommandRequest,
    CommandResponse,
    DeviceInfoResponse,
    InterfacesResponse,
    VlansResponse,
)
from app.services.switch_service import SwitchService

router = APIRouter(prefix="/api/v1/cisco/switches", tags=["Cisco Switches"])

security = HTTPBearer()


# ── Auth helpers ──


def _decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
        return payload
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {str(e)}",
        )


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    return _decode_token(credentials.credentials)


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    role = user.get("role", "")
    if role not in ("ADMIN", "SUPER_ADMIN"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required.",
        )
    return user


def _get_service(db: AsyncSession = Depends(get_db)) -> SwitchService:
    return SwitchService(db)


# ═══════════════════════════════════════════════════════
#  CRUD Endpoints
# ═══════════════════════════════════════════════════════


@router.get("", response_model=SwitchListResponse)
async def list_switches(
    svc: SwitchService = Depends(_get_service),
    user: dict = Depends(get_current_user),
):
    """List all switches."""
    try:
        switches = await svc.list_switches()
        return SwitchListResponse(switches=switches, total=len(switches))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error: {type(e).__name__}: {str(e)}",
        )


@router.get("/{switch_id}", response_model=SwitchResponse)
async def get_switch(
    switch_id: int,
    svc: SwitchService = Depends(_get_service),
    user: dict = Depends(get_current_user),
):
    """Get a single switch by ID."""
    try:
        sw = await svc.get_switch(switch_id)
        if sw is None:
            raise HTTPException(status_code=404, detail="Switch not found.")
        return sw
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get switch: {type(e).__name__}: {str(e)}",
        )


@router.post("", response_model=SwitchResponse, status_code=201)
async def create_switch(
    data: SwitchCreate,
    svc: SwitchService = Depends(_get_service),
    user: dict = Depends(require_admin),
):
    """Create a new switch (admin only)."""
    try:
        return await svc.create_switch(data)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create switch: {type(e).__name__}: {str(e)}",
        )


@router.patch("/{switch_id}", response_model=SwitchResponse)
async def update_switch(
    switch_id: int,
    data: SwitchUpdate,
    svc: SwitchService = Depends(_get_service),
    user: dict = Depends(require_admin),
):
    """Update an existing switch (admin only)."""
    try:
        sw = await svc.update_switch(switch_id, data)
        if sw is None:
            raise HTTPException(status_code=404, detail="Switch not found.")
        return sw
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update switch: {type(e).__name__}: {str(e)}",
        )


@router.delete("/{switch_id}", status_code=204)
async def delete_switch(
    switch_id: int,
    svc: SwitchService = Depends(_get_service),
    user: dict = Depends(require_admin),
):
    """Delete a switch (admin only)."""
    try:
        deleted = await svc.delete_switch(switch_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Switch not found.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete switch: {type(e).__name__}: {str(e)}",
        )


# ═══════════════════════════════════════════════════════
#  Connection & Commands
# ═══════════════════════════════════════════════════════


@router.post(
    "/{switch_id}/test-connection",
    response_model=TestConnectionResponse,
)
async def test_connection(
    switch_id: int,
    svc: SwitchService = Depends(_get_service),
    user: dict = Depends(require_admin),
):
    """
    Test connectivity to a switch.
    Tries SSH first, falls back to Telnet if protocol_preference is 'auto'.
    Returns detailed error if both fail.
    """
    try:
        return await svc.test_connection(switch_id)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Test connection failed: {type(e).__name__}: {str(e)}",
        )


@router.post("/{switch_id}/execute", response_model=CommandResponse)
async def execute_command(
    switch_id: int,
    cmd: CommandRequest,
    svc: SwitchService = Depends(_get_service),
    user: dict = Depends(require_admin),
):
    """Execute a CLI command on the switch."""
    try:
        return await svc.execute_command(switch_id, cmd)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Command execution failed: {type(e).__name__}: {str(e)}",
        )


# ═══════════════════════════════════════════════════════
#  Device Info / Interfaces / VLANs
# ═══════════════════════════════════════════════════════


@router.get("/{switch_id}/device-info", response_model=DeviceInfoResponse)
async def get_device_info(
    switch_id: int,
    svc: SwitchService = Depends(_get_service),
    user: dict = Depends(get_current_user),
):
    """Get parsed device information (show version)."""
    try:
        return await svc.get_device_info(switch_id)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get device info: {type(e).__name__}: {str(e)}",
        )


@router.get("/{switch_id}/interfaces", response_model=InterfacesResponse)
async def get_interfaces(
    switch_id: int,
    svc: SwitchService = Depends(_get_service),
    user: dict = Depends(get_current_user),
):
    """Get interface status (show ip interface brief)."""
    try:
        return await svc.get_interfaces(switch_id)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get interfaces: {type(e).__name__}: {str(e)}",
        )


@router.get("/{switch_id}/vlans", response_model=VlansResponse)
async def get_vlans(
    switch_id: int,
    svc: SwitchService = Depends(_get_service),
    user: dict = Depends(get_current_user),
):
    """Get VLAN information (show vlan brief)."""
    try:
        return await svc.get_vlans(switch_id)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get VLANs: {type(e).__name__}: {str(e)}",
        )