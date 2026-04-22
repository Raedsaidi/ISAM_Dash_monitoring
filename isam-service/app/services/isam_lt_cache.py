import logging
from datetime import datetime
from typing import Dict, Any

from sqlalchemy.orm import Session

from app.models.isam_instance import ISAMInstance
from app.models.isam_lt_slot import ISAMLTSlot
from app.models.isam_lt_port import ISAMLTPort
from app.services.isam_lt_slots_service import ISAMLTSlotsService
from app.utils.natural_sort import sort_slots, sort_ports, sort_slots_with_ports  # ← NOUVEAU

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────
#  FONCTIONS INTERNES (inchangées)
# ──────────────────────────────────────────────────────────────────────

def _replace_lt_slots_for_instance(
    db: Session,
    *,
    instance_id: int,
    slots_data: list[dict],
) -> None:
    now = datetime.utcnow()

    logger.info(
        "[CACHE-LT] Suppression des anciens slots LT pour instance #%s",
        instance_id,
    )

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

    logger.info(
        "[CACHE-LT] %d slots LT stockés pour instance #%s",
        len(slots_data),
        instance_id,
    )


def _replace_lt_ports_for_slot(
    db: Session,
    *,
    instance_id: int,
    slot_id: str,
    ports_data: list[dict],
) -> None:
    now = datetime.utcnow()

    logger.info(
        "[CACHE-LT] Suppression des anciens ports pour slot %s (instance #%s)",
        slot_id,
        instance_id,
    )

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

    logger.info(
        "[CACHE-LT] %d ports stockés pour slot %s (instance #%s)",
        len(ports_data),
        slot_id,
        instance_id,
    )


# ──────────────────────────────────────────────────────────────────────
#  REFRESH — tri AVANT insertion + tri des résultats intermédiaires
# ──────────────────────────────────────────────────────────────────────

def refresh_lt_slots_snapshot(
    db: Session,
    instance: ISAMInstance,
    timeout: int = 45,
) -> None:
    """
    Refresh complet via UNE SEULE session Telnet persistante.
    Les données sont triées naturellement AVANT insertion en BD.
    """
    logger.info(
        "[CACHE-LT] Refreshing LT slots for instance #%s (%s)",
        instance.id,
        instance.name,
    )

    service = ISAMLTSlotsService(instance)

    try:
        success, raw_slots, slots_with_ports, msg = (
            service.refresh_all_single_session(
                timeout=timeout,
                idle_timeout=20.0,
                post_send_delay=1.5,
                inter_command_delay=1.5,
            )
        )

        if not success:
            logger.warning(
                "[CACHE-LT] LT refresh failed for instance #%s : %s",
                instance.id,
                msg,
            )
            db.rollback()
            return

        # ┌──────────────────────────────────────────────────────────┐
        # │  ★ TRI NATUREL des slots et de leurs ports imbriqués    │
        # └──────────────────────────────────────────────────────────┘
        slots_with_ports = sort_slots_with_ports(
            slots_with_ports,
            slot_key="slot_id",
            ports_key="ports",
            port_sort_fields=("port_type", "port_id"),
        )

        logger.info(
            "[CACHE-LT] Slots et ports triés naturellement pour instance #%s",
            instance.id,
        )

        # ── 1. Stocker les slots ────────────────────────────────────
        slots_data = [
            {k: v for k, v in s.items() if k != "ports"}
            for s in slots_with_ports
        ]

        _replace_lt_slots_for_instance(
            db,
            instance_id=instance.id,
            slots_data=slots_data,
        )

        # ── 2. Supprimer les ports des slots obsolètes ──────────────
        current_slot_ids = [
            s["slot_id"] for s in slots_with_ports if s.get("slot_id")
        ]

        if current_slot_ids:
            db.query(ISAMLTPort).filter(
                ISAMLTPort.isam_instance_id == instance.id,
                ~ISAMLTPort.slot_id.in_(current_slot_ids),
            ).delete(synchronize_session=False)
        else:
            db.query(ISAMLTPort).filter(
                ISAMLTPort.isam_instance_id == instance.id
            ).delete(synchronize_session=False)

        # ── 3. Stocker les ports slot par slot ──────────────────────
        total_ports = 0
        for slot in slots_with_ports:
            slot_id = slot.get("slot_id")
            ports = slot.get("ports", [])

            if not slot_id:
                continue

            _replace_lt_ports_for_slot(
                db,
                instance_id=instance.id,
                slot_id=slot_id,
                ports_data=ports,
            )
            total_ports += len(ports)

        db.commit()
        logger.info(
            "[CACHE-LT] LT snapshot updated for instance #%s : %d slots, %d ports (triés)",
            instance.id,
            len(slots_with_ports),
            total_ports,
        )

    except Exception:
        db.rollback()
        logger.exception(
            "[CACHE-LT] Error while refreshing LT snapshot for instance #%s",
            instance.id,
        )
        raise


# ──────────────────────────────────────────────────────────────────────
#  CHARGEMENT DEPUIS BD — avec tri naturel Python après la requête
# ──────────────────────────────────────────────────────────────────────

def load_cached_lt_slots(db: Session, instance_id: int) -> Dict[str, Any]:
    """
    Charge les slots LT depuis la BD et les retourne triés naturellement.
    """
    rows = (
        db.query(ISAMLTSlot)
        .filter(ISAMLTSlot.isam_instance_id == instance_id)
        .all()                              # ← plus de .order_by SQL
    )

    if not rows:
        logger.info(
            "[CACHE-LT] Aucun snapshot de slots LT pour instance #%s",
            instance_id,
        )
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

    # ★ TRI NATUREL
    slots = sort_slots(slots, key_field="slot_id")

    logger.info(
        "[CACHE-LT] Chargement snapshot LT : %d slots triés pour instance #%s",
        len(slots),
        instance_id,
    )

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
    Charge les ports LT d'un slot depuis la BD et les retourne triés naturellement.
    """
    rows = (
        db.query(ISAMLTPort)
        .filter(
            ISAMLTPort.isam_instance_id == instance_id,
            ISAMLTPort.slot_id == slot_id,
        )
        .all()                              # ← plus de .order_by SQL
    )

    if not rows:
        logger.info(
            "[CACHE-LT] Aucun snapshot de ports pour slot %s (instance #%s)",
            slot_id,
            instance_id,
        )
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

    # ★ TRI NATUREL : par type puis par port_id
    ports = sort_ports(ports, key_fields=("port_type", "port_id"))

    logger.info(
        "[CACHE-LT] Chargement snapshot LT : %d ports triés pour slot %s (instance #%s)",
        len(ports),
        slot_id,
        instance_id,
    )

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