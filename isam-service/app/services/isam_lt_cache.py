import json
import logging
from datetime import datetime
from typing import Dict, Any

from sqlalchemy.orm import Session

from app.models.isam_data import ISAMData, ISAMDataType
from app.models.isam_instance import ISAMInstance
from app.models.isam_lt_slot import ISAMLTSlot
from app.models.isam_lt_port import ISAMLTPort
from app.services.isam_lt_slots_service import ISAMLTSlotsService

logger = logging.getLogger(__name__)


def get_or_create_isam_data_row(
    db: Session,
    instance_id: int,
    data_type: ISAMDataType,
) -> ISAMData:
    """Récupère ou crée une ligne ISAMData."""
    row = (
        db.query(ISAMData)
        .filter(
            ISAMData.isam_instance_id == instance_id,
            ISAMData.data_type == data_type.value,
        )
        .first()
    )
    if row is not None:
        return row

    now = datetime.utcnow()
    row = ISAMData(
        isam_instance_id=instance_id,
        data_type=data_type.value,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.flush()
    return row


def upsert_lt_slots_snapshot(
    db: Session,
    *,
    instance_id: int,
    refresh_success: bool,
    protocol_used: str | None,
    raw_output: str | None,
    slots_data: list | None,
    error_message: str | None,
) -> None:
    """
    Upsert le snapshot des LT slots.
    """
    row = get_or_create_isam_data_row(db, instance_id, ISAMDataType.LT_SLOTS)
    now = datetime.utcnow()

    row.last_refresh_at = now
    row.last_refresh_success = refresh_success
    row.last_refresh_error = None if refresh_success else (error_message or "Unknown error")
    row.updated_at = now

    if refresh_success:
        row.raw_output = raw_output or ""
        row.parsed_data = json.dumps(
            {
                "slots": slots_data or [],
                "slot_count": len(slots_data or []),
            },
            ensure_ascii=False,
        )
        row.protocol_used = protocol_used
        row.last_success_at = now

    db.add(row)
    logger.debug(f"[CACHE-LT-SLOTS] Snapshot upserted for instance #{instance_id}")


def upsert_lt_ports_snapshot(
    db: Session,
    *,
    instance_id: int,
    slot_id: str,
    refresh_success: bool,
    protocol_used: str | None,
    raw_output: str | None,
    ports_data: list | None,
    error_message: str | None,
) -> None:
    """
    Upsert le snapshot des ports LT (par slot).
    
    Note: On stocke tout dans ISAMData avec data_type="lt_ports"
    et on inclut le slot_id dans le JSON.
    """
    row = get_or_create_isam_data_row(db, instance_id, ISAMDataType.LT_PORTS)
    now = datetime.utcnow()

    row.last_refresh_at = now
    row.last_refresh_success = refresh_success
    row.last_refresh_error = None if refresh_success else (error_message or "Unknown error")
    row.updated_at = now

    if refresh_success:
        row.raw_output = raw_output or ""
        row.parsed_data = json.dumps(
            {
                "slot_id": slot_id,
                "ports": ports_data or [],
                "port_count": len(ports_data or []),
            },
            ensure_ascii=False,
        )
        row.protocol_used = protocol_used
        row.last_success_at = now

    db.add(row)
    logger.debug(f"[CACHE-LT-PORTS] Snapshot upserted for instance #{instance_id}, slot {slot_id}")


def refresh_lt_slots_snapshot(
    db: Session,
    instance: ISAMInstance,
    timeout: int = 30,
) -> None:
    """
    Refresh le snapshot des LT slots.
    """
    logger.info(f"[CACHE-LT] Refreshing LT slots for instance #{instance.id} ({instance.name})")

    service = ISAMLTSlotsService(instance)

    try:
        success, proto, raw_output, slots, msg = service.get_lt_slots(timeout=timeout)

        upsert_lt_slots_snapshot(
            db,
            instance_id=instance.id,
            refresh_success=success,
            protocol_used=proto,
            raw_output=raw_output,
            slots_data=slots,
            error_message=msg if not success else None,
        )

        # Si on a les slots, récupérer les ports pour chaque slot
        if success and slots:
            for slot in slots:
                slot_id = slot.get("slot_id")
                port_type = slot.get("port_type")

                if not slot_id or not port_type:
                    logger.warning(f"[CACHE-LT] Slot sans slot_id ou port_type: {slot}")
                    continue

                try:
                    ports_success, ports_proto, ports_raw, ports_list, ports_msg = service.get_slot_ports(
                        slot_id=slot_id,
                        port_type=port_type,
                        timeout=timeout,
                    )

                    upsert_lt_ports_snapshot(
                        db,
                        instance_id=instance.id,
                        slot_id=slot_id,
                        refresh_success=ports_success,
                        protocol_used=ports_proto,
                        raw_output=ports_raw,
                        ports_data=ports_list,
                        error_message=ports_msg if not ports_success else None,
                    )

                except Exception:
                    logger.exception(f"[CACHE-LT] Error refreshing ports for slot {slot_id}")

        db.commit()
        logger.info(f"[CACHE-LT] LT slots and ports snapshot updated for instance #{instance.id}")

    except Exception:
        db.rollback()
        logger.exception(f"[CACHE-LT] Error while refreshing LT slots snapshot for instance #{instance.id}")
        raise


def load_cached_lt_slots(db: Session, instance_id: int) -> Dict[str, Any]:
    """Charge les slots LT en cache."""
    row = (
        db.query(ISAMData)
        .filter(
            ISAMData.isam_instance_id == instance_id,
            ISAMData.data_type == ISAMDataType.LT_SLOTS.value,
        )
        .first()
    )

    if row is None or not row.parsed_data:
        return {
            "slots": [],
            "slot_count": 0,
            "last_success_at": None,
            "last_refresh_at": None,
            "last_refresh_success": False,
            "last_refresh_error": None,
            "protocol_used": None,
            "raw_output": "",
        }

    try:
        parsed = json.loads(row.parsed_data)
    except Exception:
        logger.exception("[CACHE-LT] Error parsing cached LT slots")
        parsed = {"slots": [], "slot_count": 0}

    return {
        "slots": parsed.get("slots", []),
        "slot_count": parsed.get("slot_count", 0),
        "last_success_at": row.last_success_at,
        "last_refresh_at": row.last_refresh_at,
        "last_refresh_success": row.last_refresh_success,
        "last_refresh_error": row.last_refresh_error,
        "protocol_used": row.protocol_used,
        "raw_output": row.raw_output or "",
    }


def load_cached_lt_ports(db: Session, instance_id: int, slot_id: str | None = None) -> Dict[str, Any]:
    """Charge les ports LT en cache."""
    row = (
        db.query(ISAMData)
        .filter(
            ISAMData.isam_instance_id == instance_id,
            ISAMData.data_type == ISAMDataType.LT_PORTS.value,
        )
        .first()
    )

    if row is None or not row.parsed_data:
        return {
            "ports": [],
            "port_count": 0,
            "slot_id": slot_id,
            "last_success_at": None,
            "last_refresh_at": None,
            "last_refresh_success": False,
            "last_refresh_error": None,
            "protocol_used": None,
            "raw_output": "",
        }

    try:
        parsed = json.loads(row.parsed_data)
    except Exception:
        logger.exception("[CACHE-LT] Error parsing cached LT ports")
        parsed = {"ports": [], "port_count": 0}

    return {
        "ports": parsed.get("ports", []),
        "port_count": parsed.get("port_count", 0),
        "slot_id": parsed.get("slot_id", slot_id),
        "last_success_at": row.last_success_at,
        "last_refresh_at": row.last_refresh_at,
        "last_refresh_success": row.last_refresh_success,
        "last_refresh_error": row.last_refresh_error,
        "protocol_used": row.protocol_used,
        "raw_output": row.raw_output or "",
    }