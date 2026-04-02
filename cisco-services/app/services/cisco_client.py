from typing import List, Optional
from app.models.schemas import DeviceResponse


class CiscoClient:
    async def get_devices(self) -> List[DeviceResponse]:
        # Fake data for testing
        return [
            DeviceResponse(
                id="1",
                hostname="switch-01",
                management_ip="192.168.1.1",
                platform="Catalyst 9300",
                status="reachable",
            ),
            DeviceResponse(
                id="2",
                hostname="router-01",
                management_ip="192.168.1.2",
                platform="ISR 4331",
                status="reachable",
            ),
        ]

    async def get_device(self, device_id: str) -> Optional[DeviceResponse]:
        devices = await self.get_devices()
        for d in devices:
            if d.id == device_id:
                return d
        return None