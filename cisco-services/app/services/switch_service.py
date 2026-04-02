"""
Business-logic layer for Cisco switch management.
Wraps DB operations + CiscoClient calls with comprehensive error handling.
"""

import base64
import json
import logging
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.schemas import (
    CiscoSwitch,
    SwitchCreate,
    SwitchUpdate,
    SwitchResponse,
    TestConnectionResponse,
    CommandRequest,
    CommandResponse,
    DeviceInfoResponse,
    InterfacesResponse,
    InterfaceInfo,
    VlansResponse,
    VlanInfo,
)
from app.services.cisco_client import CiscoClient

logger = logging.getLogger(__name__)


# ── Password helpers (swap for Fernet in production) ──


def _encrypt(plain: str) -> str:
    return base64.b64encode(plain.encode()).decode()


def _decrypt(cipher: str) -> str:
    return base64.b64decode(cipher.encode()).decode()


# ── ORM → Pydantic ──


def _to_response(sw: CiscoSwitch) -> SwitchResponse:
    return SwitchResponse(
        id=sw.id,
        name=sw.name,
        host=sw.host,
        ssh_port=sw.ssh_port,
        telnet_port=sw.telnet_port,
        protocol_preference=sw.protocol_preference,
        username=sw.username,
        status=sw.status,
        health_protocol_used=sw.health_protocol_used,
        last_error=sw.last_error,
        last_checked_at=sw.last_checked_at,
        last_response_time_ms=sw.last_response_time_ms,
        device_hostname=sw.device_hostname,
        device_model=sw.device_model,
        ios_version=sw.ios_version,
        serial_number=sw.serial_number,
        cache_updated_at=sw.cache_updated_at,
        created_at=sw.created_at,
        updated_at=sw.updated_at,
    )


# ── Build a CiscoClient from a DB row ──


def _build_client(sw: CiscoSwitch) -> CiscoClient:
    return CiscoClient(
        host=sw.host,
        username=sw.username,
        password=_decrypt(sw.password_encrypted),
        ssh_port=sw.ssh_port,
        telnet_port=sw.telnet_port,
        enable_password=(
            _decrypt(sw.enable_password_encrypted)
            if sw.enable_password_encrypted
            else None
        ),
        protocol_preference=sw.protocol_preference,
    )


# ═══════════════════════════════════════════════════════
#  Service
# ═══════════════════════════════════════════════════════


class SwitchService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ── helpers ──

    async def _get_switch_or_none(self, switch_id: int) -> Optional[CiscoSwitch]:
        try:
            result = await self.db.execute(
                select(CiscoSwitch).where(CiscoSwitch.id == switch_id)
            )
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"DB error fetching switch {switch_id}: {e}", exc_info=True)
            raise RuntimeError(f"Database error: {str(e)}")

    # ────────────────────────────────────────
    #  CRUD
    # ────────────────────────────────────────

    async def list_switches(self) -> List[SwitchResponse]:
        try:
            result = await self.db.execute(
                select(CiscoSwitch).order_by(CiscoSwitch.created_at.desc())
            )
            return [_to_response(sw) for sw in result.scalars().all()]
        except Exception as e:
            logger.error(f"Failed to list switches: {e}", exc_info=True)
            raise RuntimeError(f"Database error listing switches: {str(e)}")

    async def get_switch(self, switch_id: int) -> Optional[SwitchResponse]:
        sw = await self._get_switch_or_none(switch_id)
        return _to_response(sw) if sw else None

    async def create_switch(self, data: SwitchCreate) -> SwitchResponse:
        try:
            sw = CiscoSwitch(
                name=data.name.strip(),
                host=data.host.strip(),
                ssh_port=data.ssh_port,
                telnet_port=data.telnet_port,
                protocol_preference=data.protocol_preference.value,
                username=data.username.strip(),
                password_encrypted=_encrypt(data.password),
                enable_password_encrypted=(
                    _encrypt(data.enable_password)
                    if data.enable_password
                    else None
                ),
                status="inactive",
            )
            self.db.add(sw)
            await self.db.commit()
            await self.db.refresh(sw)
            logger.info(f"Created switch '{sw.name}' (id={sw.id})")
            return _to_response(sw)
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Failed to create switch: {e}", exc_info=True)
            raise RuntimeError(f"Failed to create switch: {str(e)}")

    async def update_switch(
        self, switch_id: int, data: SwitchUpdate
    ) -> Optional[SwitchResponse]:
        try:
            sw = await self._get_switch_or_none(switch_id)
            if sw is None:
                return None

            if data.name is not None:
                sw.name = data.name.strip()
            if data.host is not None:
                sw.host = data.host.strip()
            if data.ssh_port is not None:
                sw.ssh_port = data.ssh_port
            if data.telnet_port is not None:
                sw.telnet_port = data.telnet_port
            if data.protocol_preference is not None:
                sw.protocol_preference = data.protocol_preference.value
            if data.username is not None:
                sw.username = data.username.strip()
            if data.password is not None:
                sw.password_encrypted = _encrypt(data.password)
            if data.enable_password is not None:
                sw.enable_password_encrypted = _encrypt(data.enable_password)

            await self.db.commit()
            await self.db.refresh(sw)
            logger.info(f"Updated switch '{sw.name}' (id={sw.id})")
            return _to_response(sw)
        except RuntimeError:
            raise
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Failed to update switch {switch_id}: {e}", exc_info=True)
            raise RuntimeError(f"Failed to update switch: {str(e)}")

    async def delete_switch(self, switch_id: int) -> bool:
        try:
            sw = await self._get_switch_or_none(switch_id)
            if sw is None:
                return False
            await self.db.delete(sw)
            await self.db.commit()
            logger.info(f"Deleted switch id={switch_id}")
            return True
        except RuntimeError:
            raise
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Failed to delete switch {switch_id}: {e}", exc_info=True)
            raise RuntimeError(f"Failed to delete switch: {str(e)}")

    # ────────────────────────────────────────
    #  Test Connection
    # ────────────────────────────────────────

    async def test_connection(self, switch_id: int) -> TestConnectionResponse:
        try:
            sw = await self._get_switch_or_none(switch_id)
        except RuntimeError as e:
            return TestConnectionResponse(
                success=False, status="error", message=str(e)
            )

        if sw is None:
            return TestConnectionResponse(
                success=False,
                status="error",
                message=f"Switch with id {switch_id} not found.",
            )

        client = _build_client(sw)

        try:
            success, proto, error_msg, response_time = await client.test_connection()
        except Exception as e:
            success = False
            proto = "none"
            error_msg = f"Unexpected error: {type(e).__name__}: {str(e)}"
            response_time = None

        # Persist results
        try:
            now = datetime.now(timezone.utc)
            sw.last_checked_at = now
            sw.health_protocol_used = proto if proto != "none" else None
            sw.last_response_time_ms = response_time

            if success:
                sw.status = "active"
                sw.last_error = None

                # Also grab device info on success
                try:
                    info = await client.get_device_info()
                    if info.get("success"):
                        sw.device_hostname = info.get("hostname")
                        sw.device_model = info.get("model")
                        sw.ios_version = info.get("ios_version")
                        sw.serial_number = info.get("serial_number")
                except Exception as info_err:
                    logger.warning(
                        f"Could not fetch device info after connection: {info_err}"
                    )
            else:
                sw.status = "error"
                sw.last_error = error_msg

            await self.db.commit()
            await self.db.refresh(sw)
        except Exception as db_err:
            logger.error(f"DB update after test failed: {db_err}", exc_info=True)

        if success:
            msg = (
                f"Successfully connected via {proto.upper()} in {response_time}ms."
            )
        else:
            msg = f"Connection failed: {error_msg}"

        return TestConnectionResponse(
            success=success,
            protocol_used=proto if proto != "none" else None,
            status="active" if success else "error",
            message=msg,
            response_time_ms=response_time,
            last_error=error_msg if not success else None,
            device_info=(
                {
                    "hostname": sw.device_hostname,
                    "model": sw.device_model,
                    "ios_version": sw.ios_version,
                    "serial_number": sw.serial_number,
                }
                if success
                else None
            ),
        )

    # ────────────────────────────────────────
    #  Execute Command
    # ────────────────────────────────────────

    async def execute_command(
        self, switch_id: int, cmd: CommandRequest
    ) -> CommandResponse:
        try:
            sw = await self._get_switch_or_none(switch_id)
        except RuntimeError as e:
            return CommandResponse(
                success=False, command=cmd.command, error=str(e)
            )

        if sw is None:
            return CommandResponse(
                success=False,
                command=cmd.command,
                error=f"Switch {switch_id} not found.",
            )

        client = _build_client(sw)

        try:
            ok, proto, output, error, elapsed = await client.execute_command(
                cmd.command, cmd.enable_mode
            )
        except Exception as e:
            return CommandResponse(
                success=False,
                command=cmd.command,
                error=f"Unexpected error: {type(e).__name__}: {str(e)}",
            )

        return CommandResponse(
            success=ok,
            command=cmd.command,
            output=output,
            error=error,
            protocol_used=proto if proto != "none" else None,
            execution_time_ms=elapsed,
        )

    # ────────────────────────────────────────
    #  Device Info
    # ────────────────────────────────────────

    async def get_device_info(self, switch_id: int) -> DeviceInfoResponse:
        try:
            sw = await self._get_switch_or_none(switch_id)
        except RuntimeError as e:
            return DeviceInfoResponse(success=False, error=str(e))

        if sw is None:
            return DeviceInfoResponse(
                success=False, error=f"Switch {switch_id} not found."
            )

        client = _build_client(sw)

        try:
            info = await client.get_device_info()
        except Exception as e:
            return DeviceInfoResponse(
                success=False,
                error=f"Unexpected error: {type(e).__name__}: {str(e)}",
            )

        return DeviceInfoResponse(**info)

    # ────────────────────────────────────────
    #  Interfaces
    # ────────────────────────────────────────

    async def get_interfaces(self, switch_id: int) -> InterfacesResponse:
        try:
            sw = await self._get_switch_or_none(switch_id)
        except RuntimeError as e:
            return InterfacesResponse(success=False, error=str(e))

        if sw is None:
            return InterfacesResponse(
                success=False, error=f"Switch {switch_id} not found."
            )

        client = _build_client(sw)

        try:
            data = await client.get_interfaces()
        except Exception as e:
            return InterfacesResponse(
                success=False,
                error=f"Unexpected error: {type(e).__name__}: {str(e)}",
            )

        interfaces = [
            InterfaceInfo(**iface) for iface in data.get("interfaces", [])
        ]

        # Cache
        try:
            sw.cached_interfaces = json.dumps(data.get("interfaces", []))
            sw.cache_updated_at = datetime.now(timezone.utc)
            await self.db.commit()
        except Exception as cache_err:
            logger.warning(f"Failed to cache interfaces: {cache_err}")

        return InterfacesResponse(
            success=data.get("success", False),
            interfaces=interfaces,
            total=len(interfaces),
            protocol_used=data.get("protocol_used"),
            error=data.get("error"),
            cached_at=sw.cache_updated_at,
        )

    # ────────────────────────────────────────
    #  VLANs
    # ────────────────────────────────────────

    async def get_vlans(self, switch_id: int) -> VlansResponse:
        try:
            sw = await self._get_switch_or_none(switch_id)
        except RuntimeError as e:
            return VlansResponse(success=False, error=str(e))

        if sw is None:
            return VlansResponse(
                success=False, error=f"Switch {switch_id} not found."
            )

        client = _build_client(sw)

        try:
            data = await client.get_vlans()
        except Exception as e:
            return VlansResponse(
                success=False,
                error=f"Unexpected error: {type(e).__name__}: {str(e)}",
            )

        vlans = [VlanInfo(**v) for v in data.get("vlans", [])]

        # Cache
        try:
            sw.cached_vlans = json.dumps(data.get("vlans", []))
            sw.cache_updated_at = datetime.now(timezone.utc)
            await self.db.commit()
        except Exception as cache_err:
            logger.warning(f"Failed to cache VLANs: {cache_err}")

        return VlansResponse(
            success=data.get("success", False),
            vlans=vlans,
            total=len(vlans),
            protocol_used=data.get("protocol_used"),
            error=data.get("error"),
            cached_at=sw.cache_updated_at,
        )