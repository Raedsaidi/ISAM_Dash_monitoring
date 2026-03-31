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
    """
    Remplace complètement les ports d'un slot donné
    par le dernier snapshot réussi.
    """
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


def refresh_lt_slots_snapshot(
    db: Session,
    instance: ISAMInstance,
    timeout: int = 30,
) -> None:
    """
    Refresh complet via UNE SEULE session Telnet persistante :

      1. ouvre 1 session Telnet
      2. envoie la commande slots → parse
      3. pour chaque slot, envoie la commande ports → parse
      4. ferme la session
      5. remplace slots + ports en base

    Si le refresh échoue → l'ancien snapshot est conservé.
    Si les ports d'un slot échouent → l'ancien snapshot de ce slot est conservé.
    """
    logger.info(
        "[CACHE-LT] Refreshing LT slots for instance #%s (%s)",
        instance.id,
        instance.name,
    )

    service = ISAMLTSlotsService(instance)

    try:
        # ── Récupération via session unique ─────────────────────────
        success, raw_slots, slots_with_ports, msg = (
            service.refresh_all_single_session(
                timeout=timeout,
                idle_timeout=3.0,            # 3s au lieu de 1s → attend les vraies données
                post_send_delay=1.0,         # 1s de pause après envoi avant de lire
                inter_command_delay=1.0,     # 1s entre chaque commande
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

        # ── 1. Stocker les slots (sans la clé "ports") ──────────────
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
            logger.info(
                "[CACHE-LT] Suppression des ports pour les slots obsolètes (instance #%s)",
                instance.id,
            )
            db.query(ISAMLTPort).filter(
                ISAMLTPort.isam_instance_id == instance.id,
                ~ISAMLTPort.slot_id.in_(current_slot_ids),
            ).delete(synchronize_session=False)
        else:
            logger.info(
                "[CACHE-LT] Aucun slot LT, suppression de tous les ports LT (instance #%s)",
                instance.id,
            )
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

            if ports:
                # On a des ports → remplacer
                _replace_lt_ports_for_slot(
                    db,
                    instance_id=instance.id,
                    slot_id=slot_id,
                    ports_data=ports,
                )
                total_ports += len(ports)
            else:
                # Pas de ports récupérés pour ce slot.
                # On supprime les anciens ports de ce slot
                # (le slot existe mais n'a pas de ports, ou la commande
                # n'a rien retourné — ex: slot "empty").
                _replace_lt_ports_for_slot(
                    db,
                    instance_id=instance.id,
                    slot_id=slot_id,
                    ports_data=[],
                )

        db.commit()
        logger.info(
            "[CACHE-LT] LT snapshot updated for instance #%s : %d slots, %d ports",
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

    logger.info(
        "[CACHE-LT] Chargement snapshot LT : %d slots pour instance #%s",
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
    Charge les ports LT d'un slot précis depuis la table dédiée ISAMLTPort.
    slot_id doit être au format complet, ex: "lt:1/1/5".
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

    logger.info(
        "[CACHE-LT] Chargement snapshot LT : %d ports pour slot %s (instance #%s)",
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