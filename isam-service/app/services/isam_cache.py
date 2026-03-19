import json
import logging
from datetime import datetime
from typing import Any, Dict

from sqlalchemy.orm import Session

from app.models.isam_data import ISAMData, ISAMDataType
from app.models.isam_instance import ISAMInstance
from app.services.isam_data import ISAMDataService

logger = logging.getLogger(__name__)


def get_cached_isam_data(
    db: Session,
    instance_id: int,
    data_type: ISAMDataType,
) -> ISAMData | None:
    return (
        db.query(ISAMData)
        .filter(
            ISAMData.isam_instance_id == instance_id,
            ISAMData.data_type == data_type.value,
        )
        .first()
    )


def load_cached_parsed_data(row: ISAMData | None) -> Dict[str, Any]:
    if row is None or not row.parsed_data:
        return {}

    try:
        data = json.loads(row.parsed_data)
        return data if isinstance(data, dict) else {}
    except Exception:
        logger.exception("[CACHE] Impossible de parser parsed_data.")
        return {}


def _get_or_create_row(
    db: Session,
    instance_id: int,
    data_type: ISAMDataType,
) -> ISAMData:
    row = get_cached_isam_data(db, instance_id, data_type)
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


def upsert_cached_snapshot(
    db: Session,
    *,
    instance_id: int,
    data_type: ISAMDataType,
    refresh_success: bool,
    protocol_used: str | None,
    raw_output: str | None,
    parsed_data: Dict[str, Any] | None,
    error_message: str | None,
) -> None:
    row = _get_or_create_row(db, instance_id, data_type)
    now = datetime.utcnow()

    row.last_refresh_at = now
    row.last_refresh_success = refresh_success
    row.last_refresh_error = None if refresh_success else (error_message or "Unknown error")
    row.updated_at = now

    # IMPORTANT :
    # on n'écrase le snapshot que si la collecte réussit
    if refresh_success:
        row.raw_output = raw_output or ""
        row.parsed_data = json.dumps(parsed_data or {}, ensure_ascii=False)
        row.protocol_used = protocol_used
        row.last_success_at = now

    db.add(row)


def refresh_isam_data_snapshot_for_instance(
    db: Session,
    instance: ISAMInstance,
) -> None:
    logger.info(f"[CACHE] Refresh cache for ISAM instance #{instance.id} ({instance.name})")

    service = ISAMDataService(instance)

    try:
        mem_ok, mem_proto, mem_raw, mem_parsed, mem_msg = service.get_memory_usage(timeout=20)
        upsert_cached_snapshot(
            db,
            instance_id=instance.id,
            data_type=ISAMDataType.MEMORY_USAGE,
            refresh_success=mem_ok,
            protocol_used=mem_proto,
            raw_output=mem_raw,
            parsed_data=mem_parsed,
            error_message=mem_msg,
        )

        ports_ok, ports_proto, ports_raw, ports_parsed, ports_msg = service.get_ports(timeout=30)
        upsert_cached_snapshot(
            db,
            instance_id=instance.id,
            data_type=ISAMDataType.PORTS,
            refresh_success=ports_ok,
            protocol_used=ports_proto,
            raw_output=ports_raw,
            parsed_data=ports_parsed,
            error_message=ports_msg,
        )

        db.commit()
        logger.info(f"[CACHE] Cache updated for instance #{instance.id}")

    except Exception:
        db.rollback()
        logger.exception(f"[CACHE] Error while refreshing cache for instance #{instance.id}")
        raise