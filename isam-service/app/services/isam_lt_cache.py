import logging
from datetime import datetime
from typing import Dict, Any

from sqlalchemy.orm import Session

from app.models.isam_instance import ISAMInstance
from app.models.isam_lt_slot import ISAMLTSlot
from app.models.isam_lt_port import ISAMLTPort
from app.services.isam_lt_slots_service import ISAMLTSlotsService

logger = logging.getLogger(__name__)


def _replace_lt_slots_for_instance(
    db: Session,
    *,
    instance_id: int,
    slots_data: list[dict],
) -> None:
    """
    Remplace complètement les slots LT d'une instance
    par le dernier snapshot réussi.
    """
    now = datetime.utcnow()

    db.query(ISAMLTSlot).filter(
        ISAMLTSlot.isam_instance_id == instance_id
    ).delete(synchronize_session=False)

    for slot in slots_data:
        db.add(
            ISAMLTSlot(
                isam_instance_id=instance_id,
                slot_id=slot["slot_id"],
                board=slot["board"],
                admin_state=slot["admin_state"],
                link_state=slot["link_state"],
                port_state=slot["port_state"],
                cfg_mtu=slot["cfg_mtu"],
                oper_mtu=slot["oper_mtu"],
                lag_bndl=slot["lag_bndl"],
                mode=slot["mode"],
                encap=slot["encap"],
                port_type=slot["port_type"],
                last_success_at=now,
                created_at=now,
                updated_at=now,
            )
        )


def _replace_lt_ports_for_slot(
    db: Session,
    *,
    instance_id: int,
    slot_id: str,
    ports_data: list[dict],
) -> None:
    """
    Remplace complètement les ports d'un slot donné
    par le dernier snapshot réussi.
    """
    now = datetime.utcnow()

    db.query(ISAMLTPort).filter(
        ISAMLTPort.isam_instance_id == instance_id,
        ISAMLTPort.slot_id == slot_id,
    ).delete(synchronize_session=False)

    for port in ports_data:
        db.add(
            ISAMLTPort(
                isam_instance_id=instance_id,
                slot_id=slot_id,
                port_id=port["port_id"],
                port_type=port["port_type"],
                admin_state=port["admin_state"],
                link_state=port["link_state"],
                port_state=port["port_state"],
                cfg_mtu=port["cfg_mtu"],
                oper_mtu=port["oper_mtu"],
                lag_bndl=port["lag_bndl"],
                mode=port["mode"],
                encap=port["encap"],
                board=port["board"],
                raw_line=port.get("raw_line"),
                last_success_at=now,
                created_at=now,
                updated_at=now,
            )
        )


def refresh_lt_slots_snapshot(
    db: Session,
    instance: ISAMInstance,
    timeout: int = 30,
) -> None:
    """
    Refresh complet :
    1. récupère les slots LT
    2. remplace les slots en base si succès
    3. récupère les ports de chaque slot
    4. remplace les ports slot par slot si succès

    Important :
    - si la récupération des slots échoue -> on garde l'ancien snapshot
    - si la récupération des ports d'un slot échoue -> on garde les anciens ports de ce slot
    """
    logger.info(f"[CACHE-LT] Refreshing LT slots for instance #{instance.id} ({instance.name})")

    service = ISAMLTSlotsService(instance)

    try:
        success, proto, raw_output, slots, msg = service.get_lt_slots(timeout=timeout)

        if not success:
            logger.warning(
                f"[CACHE-LT] LT slots refresh failed for instance #{instance.id}: {msg}"
            )
            db.rollback()
            return

        # 1) Remplacer les slots
        _replace_lt_slots_for_instance(
            db,
            instance_id=instance.id,
            slots_data=slots,
        )

        # 2) Supprimer les ports des slots qui n'existent plus
        current_slot_ids = [slot["slot_id"] for slot in slots if slot.get("slot_id")]

        if current_slot_ids:
            db.query(ISAMLTPort).filter(
                ISAMLTPort.isam_instance_id == instance.id,
                ~ISAMLTPort.slot_id.in_(current_slot_ids),
            ).delete(synchronize_session=False)
        else:
            db.query(ISAMLTPort).filter(
                ISAMLTPort.isam_instance_id == instance.id
            ).delete(synchronize_session=False)

        # 3) Refresh ports slot par slot
        for slot in slots:
            slot_id = slot.get("slot_id")
            port_type = slot.get("port_type")

            if not slot_id or not port_type:
                logger.warning(f"[CACHE-LT] Invalid slot data: {slot}")
                continue

            try:
                ports_success, ports_proto, ports_raw, ports_list, ports_msg = service.get_slot_ports(
                    slot_id=slot_id,
                    port_type=port_type,
                    timeout=timeout,
                )

                if ports_success:
                    _replace_lt_ports_for_slot(
                        db,
                        instance_id=instance.id,
                        slot_id=slot_id,
                        ports_data=ports_list,
                    )
                    logger.info(
                        f"[CACHE-LT] Stored {len(ports_list)} ports for slot {slot_id}"
                    )
                else:
                    logger.warning(
                        f"[CACHE-LT] Failed to refresh ports for slot {slot_id}: {ports_msg}"
                    )
                    # On garde l'ancien snapshot de ce slot

            except Exception:
                logger.exception(f"[CACHE-LT] Error refreshing ports for slot {slot_id}")
                # On garde l'ancien snapshot de ce slot

        db.commit()
        logger.info(f"[CACHE-LT] LT snapshot updated for instance #{instance.id}")

    except Exception:
        db.rollback()
        logger.exception(
            f"[CACHE-LT] Error while refreshing LT snapshot for instance #{instance.id}"
        )
        raise


def load_cached_lt_slots(db: Session, instance_id: int) -> Dict[str, Any]:
    """
    Charge les slots LT depuis la table dédiée ISAMLTSlot.
    """
    rows = (
        db.query(ISAMLTSlot)
        .filter(ISAMLTSlot.isam_instance_id == instance_id)
        .order_by(ISAMLTSlot.slot_id.asc())
        .all()
    )

    if not rows:
        return {
            "slots": [],
            "slot_count": 0,
            "last_success_at": None,
            "last_refresh_at": None,
            "last_refresh_success": False,
            "last_refresh_error": None,
            "protocol_used": None,
            "raw_output": "",
            "message": "No snapshot available yet",
        }

    last_success_at = max(
        (row.last_success_at for row in rows if row.last_success_at is not None),
        default=None,
    )

    slots = [
        {
            "slot_id": row.slot_id,
            "board": row.board,
            "admin_state": row.admin_state,
            "link_state": row.link_state,
            "port_state": row.port_state,
            "cfg_mtu": row.cfg_mtu,
            "oper_mtu": row.oper_mtu,
            "lag_bndl": row.lag_bndl,
            "mode": row.mode,
            "encap": row.encap,
            "port_type": row.port_type,
        }
        for row in rows
    ]

    return {
        "slots": slots,
        "slot_count": len(slots),
        "last_success_at": last_success_at,
        "last_refresh_at": last_success_at,
        "last_refresh_success": True,
        "last_refresh_error": None,
        "protocol_used": None,
        "raw_output": "",
        "message": "OK",
    }


def load_cached_lt_ports(db: Session, instance_id: int, slot_id: str) -> Dict[str, Any]:
    """
    Charge les ports LT d'un slot précis depuis la table dédiée ISAMLTPort.
    """
    rows = (
        db.query(ISAMLTPort)
        .filter(
            ISAMLTPort.isam_instance_id == instance_id,
            ISAMLTPort.slot_id == slot_id,
        )
        .order_by(ISAMLTPort.port_id.asc())
        .all()
    )

    if not rows:
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
            "message": "No snapshot available yet for this slot",
        }

    last_success_at = max(
        (row.last_success_at for row in rows if row.last_success_at is not None),
        default=None,
    )

    ports = [
        {
            "port_id": row.port_id,
            "slot_id": row.slot_id,
            "port_type": row.port_type,
            "admin_state": row.admin_state,
            "link_state": row.link_state,
            "port_state": row.port_state,
            "cfg_mtu": row.cfg_mtu,
            "oper_mtu": row.oper_mtu,
            "lag_bndl": row.lag_bndl,
            "mode": row.mode,
            "encap": row.encap,
            "board": row.board,
        }
        for row in rows
    ]

    return {
        "ports": ports,
        "port_count": len(ports),
        "slot_id": slot_id,
        "last_success_at": last_success_at,
        "last_refresh_at": last_success_at,
        "last_refresh_success": True,
        "last_refresh_error": None,
        "protocol_used": None,
        "raw_output": "",
        "message": "OK",
    }