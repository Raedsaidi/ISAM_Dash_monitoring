# app/services/isam_sfp_cache.py
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List

from sqlalchemy.orm import Session

from app.models.isam_instance import ISAMInstance
from app.models.isam_lt_slot import ISAMLTSlot
from app.models.isam_sfp_port import ISAMSFPPort
from app.services.isam_transceiver import ISAMTransceiverService, parse_transceiver_lines

logger = logging.getLogger(__name__)

# ── Taille du batch de commit ─────────────────────────────────────────────────
SFP_COMMIT_BATCH_SIZE = 5


# ─────────────────────────────────────────────────────────────────────────────
# Helpers internes
# ─────────────────────────────────────────────────────────────────────────────

def _get_slot_short_ids_for_instance(db: Session, instance_id: int) -> List[str]:
    """
    Récupère tous les slot_short_id connus pour une instance
    depuis isam_lt_slots (déjà synchronisée par isam_lt_cache).
    slot_id = "lt:1/1/6" → slot_short_id = "1/1/6"
    """
    rows = (
        db.query(ISAMLTSlot.slot_id)
        .filter(ISAMLTSlot.isam_instance_id == instance_id)
        .all()
    )

    slot_short_ids: List[str] = []
    for (slot_id,) in rows:
        short = (slot_id or "").replace("lt:", "").strip()
        if short:
            slot_short_ids.append(short)

    logger.info(
        "[CACHE-SFP] %d slots trouvés pour instance #%s : %s",
        len(slot_short_ids),
        instance_id,
        slot_short_ids,
    )
    return slot_short_ids


def _replace_sfp_for_slot(
    db: Session,
    *,
    instance_id: int,
    slot_short_id: str,
    sfp_entries: List[Dict[str, Any]],
) -> None:
    """
    Delete + Insert pour un slot donné.
    Même stratégie que _replace_lt_ports_for_slot.
    PAS de commit ici — géré par le caller (batch).
    """
    now = datetime.utcnow()

    logger.info(
        "[CACHE-SFP] Suppression SFP slot %s (instance #%s)",
        slot_short_id,
        instance_id,
    )

    db.query(ISAMSFPPort).filter(
        ISAMSFPPort.isam_instance_id == instance_id,
        ISAMSFPPort.slot_short_id    == slot_short_id,
    ).delete(synchronize_session=False)

    for entry in sfp_entries:
        db.add(ISAMSFPPort(
            isam_instance_id = instance_id,
            slot_short_id    = entry["slot_short_id"],
            slot_id          = entry["slot_id"],
            sfp_index        = entry["sfp_index"],
            sfp_id           = entry["sfp_id"],
            port_id          = entry["port_id"],
            status           = entry["status"],
            is_empty         = entry["is_empty"],
            is_active        = entry["is_active"],
            is_copper        = entry["is_copper"],
            part_number      = entry.get("part_number"),
            wavelength       = entry.get("wavelength"),
            fiber_mode       = entry.get("fiber_mode"),
            standard         = entry.get("standard"),
            speed            = entry.get("speed"),
            direction        = entry.get("direction"),
            media            = entry.get("media"),
            tx_wavelength    = entry.get("tx_wavelength"),
            rx_wavelength    = entry.get("rx_wavelength"),
            last_refresh_at  = now,
            created_at       = now,
            updated_at       = now,
        ))

    logger.info(
        "[CACHE-SFP] %d SFP insérés pour slot %s (instance #%s)",
        len(sfp_entries),
        slot_short_id,
        instance_id,
    )


def _row_to_dict(row: ISAMSFPPort) -> Dict[str, Any]:
    return {
        "sfp_id":          row.sfp_id,
        "slot_id":         row.slot_id,
        "slot_short_id":   row.slot_short_id,
        "sfp_index":       row.sfp_index,
        "port_id":         row.port_id,
        "status":          row.status,
        "is_empty":        row.is_empty,
        "is_active":       row.is_active,
        "is_copper":       row.is_copper,
        "part_number":     row.part_number,
        "wavelength":      row.wavelength,
        "fiber_mode":      row.fiber_mode,
        "standard":        row.standard,
        "speed":           row.speed,
        "direction":       row.direction,
        "media":           row.media,
        "tx_wavelength":   row.tx_wavelength,
        "rx_wavelength":   row.rx_wavelength,
        "last_refresh_at": (
            row.last_refresh_at.isoformat() if row.last_refresh_at else None
        ),
    }


# ─────────────────────────────────────────────────────────────────────────────
# REFRESH — avec commit par batch de SFP_COMMIT_BATCH_SIZE slots
# ─────────────────────────────────────────────────────────────────────────────

def refresh_sfp_snapshot(
    db: Session,
    instance: ISAMInstance,
    *,
    timeout: int = 30,
    commit_batch_size: int = SFP_COMMIT_BATCH_SIZE,
) -> None:
    """
    Refresh complet des SFP pour une instance.

    Stratégie (identique aux autres services) :
      1) Récupère les slot_short_ids depuis isam_lt_slots
      2) Ouvre UNE session persistante SSH/Telnet
      3) Pour chaque slot :
           - show equipment transceiver-inventory | match exact:<slot>
           - parse
           - delete + insert dans isam_sfp_ports
           - commit tous les <commit_batch_size> slots  ← NOUVEAU
      4) Commit final si reliquat
      5) Supprime les SFP des slots obsolètes

    Le commit par batch évite d'attendre la fin complète avant
    toute sauvegarde en DB.
    """
    logger.info(
        "[CACHE-SFP] Refreshing SFP snapshot pour instance #%s (%s) "
        "— batch_size=%d",
        instance.id,
        instance.name,
        commit_batch_size,
    )

    # ── 1. Récupérer les slots connus ────────────────────────────────────────
    slot_short_ids = _get_slot_short_ids_for_instance(db, instance.id)

    if not slot_short_ids:
        logger.warning(
            "[CACHE-SFP] Aucun slot LT connu pour instance #%s — "
            "lancez d'abord un refresh LT.",
            instance.id,
        )
        return

    # ── 2. Ouvrir la session persistante ─────────────────────────────────────
    from app.services.isam_transceiver import _open_best_session
    from app.services.isam_connection import ISAMConnectionService

    conn_service = ISAMConnectionService(instance)
    ok_open, protocol, session, conn_msg = _open_best_session(
        instance, conn_service, timeout
    )

    if not ok_open or session is None:
        logger.error(
            "[CACHE-SFP] Impossible d'ouvrir la session pour instance #%s : %s",
            instance.id,
            conn_msg,
        )
        raise RuntimeError(f"[CACHE-SFP] Session impossible : {conn_msg}")

    logger.info(
        "[CACHE-SFP] Session %s ouverte pour instance #%s",
        protocol,
        instance.id,
    )

    # ── 3. Traitement slot par slot avec commit batch ─────────────────────────
    total_sfp      = 0
    ok_slots       = 0
    err_slots      = 0
    processed      = 0          # slots traités depuis le dernier commit
    slots_done     = []         # slot_short_ids traités avec succès

    import time

    try:
        for idx, slot_short in enumerate(slot_short_ids):
            slot_short = slot_short.strip()
            if not slot_short:
                continue

            # délai inter-slot
            if idx > 0:
                time.sleep(0.8)

            # ── Fetch CLI ─────────────────────────────────────────────────
            cmd = (
                f"show equipment transceiver-inventory "
                f"| match exact:{slot_short}"
            )
            logger.info(
                "[CACHE-SFP] Slot %s — envoi commande : %r",
                slot_short,
                cmd,
            )

            try:
                ok_cmd, raw, err = session.execute(
                    cmd,
                    idle_timeout=5.0,
                    post_send_delay=1.5,
                )
            except Exception as e:
                logger.error(
                    "[CACHE-SFP] Slot %s — erreur execute : %s",
                    slot_short, e,
                )
                err_slots += 1
                continue

            if not ok_cmd:
                logger.warning(
                    "[CACHE-SFP] Slot %s — commande KO : %s",
                    slot_short, err,
                )
                err_slots += 1
                continue

            # ── Parse ─────────────────────────────────────────────────────
            sfp_entries = parse_transceiver_lines(raw or "")

            logger.info(
                "[CACHE-SFP] Slot %s → %d SFP parsés",
                slot_short,
                len(sfp_entries),
            )

            # ── Delete + Insert (sans commit) ─────────────────────────────
            try:
                _replace_sfp_for_slot(
                    db,
                    instance_id=instance.id,
                    slot_short_id=slot_short,
                    sfp_entries=sfp_entries,
                )
            except Exception as e:
                logger.error(
                    "[CACHE-SFP] Slot %s — erreur insert DB : %s",
                    slot_short, e,
                )
                db.rollback()
                err_slots += 1
                continue

            total_sfp  += len(sfp_entries)
            ok_slots   += 1
            processed  += 1
            slots_done.append(slot_short)

            # ── Commit batch tous les N slots ─────────────────────────────
            if commit_batch_size > 0 and processed % commit_batch_size == 0:
                try:
                    db.commit()
                    logger.info(
                        "[CACHE-SFP] Batch commit après %d slots "
                        "(instance #%s) — %d SFP sauvegardés jusqu'ici",
                        processed,
                        instance.id,
                        total_sfp,
                    )
                except Exception as e:
                    logger.error(
                        "[CACHE-SFP] Erreur batch commit : %s", e
                    )
                    db.rollback()

        # ── Commit final (reliquat) ───────────────────────────────────────
        if processed % commit_batch_size != 0 or commit_batch_size <= 0:
            try:
                db.commit()
                logger.info(
                    "[CACHE-SFP] Commit final — %d slots OK, %d SFP "
                    "(instance #%s)",
                    ok_slots,
                    total_sfp,
                    instance.id,
                )
            except Exception as e:
                logger.error("[CACHE-SFP] Erreur commit final : %s", e)
                db.rollback()

        # ── Supprimer les SFP des slots obsolètes ────────────────────────
        if slot_short_ids:
            try:
                db.query(ISAMSFPPort).filter(
                    ISAMSFPPort.isam_instance_id == instance.id,
                    ~ISAMSFPPort.slot_short_id.in_(slot_short_ids),
                ).delete(synchronize_session=False)
                db.commit()
                logger.info(
                    "[CACHE-SFP] SFP obsolètes supprimés pour instance #%s",
                    instance.id,
                )
            except Exception as e:
                logger.error(
                    "[CACHE-SFP] Erreur suppression SFP obsolètes : %s", e
                )
                db.rollback()

    finally:
        try:
            session.close()
        except Exception:
            pass

    logger.info(
        "[CACHE-SFP] Refresh terminé pour instance #%s : "
        "%d slots OK, %d slots KO, %d SFP total (proto=%s)",
        instance.id,
        ok_slots,
        err_slots,
        total_sfp,
        protocol,
    )


# ─────────────────────────────────────────────────────────────────────────────
# LOAD — même pattern que load_cached_lt_ports
# ─────────────────────────────────────────────────────────────────────────────

def load_cached_sfp_slot(
    db: Session,
    instance_id: int,
    slot_short_id: str,
) -> Dict[str, Any]:
    """
    Charge les SFP d'un slot depuis la DB (triés par sfp_index).
    Même pattern que load_cached_lt_ports.
    """
    rows = (
        db.query(ISAMSFPPort)
        .filter(
            ISAMSFPPort.isam_instance_id == instance_id,
            ISAMSFPPort.slot_short_id    == slot_short_id,
        )
        .order_by(ISAMSFPPort.sfp_index.asc())
        .all()
    )

    if not rows:
        logger.info(
            "[CACHE-SFP] Aucun snapshot SFP pour slot %s (instance #%s)",
            slot_short_id,
            instance_id,
        )
        return {
            "sfp":                  [],
            "sfp_count":            0,
            "slot_short_id":        slot_short_id,
            "last_success_at":      None,
            "last_refresh_at":      None,
            "last_refresh_success": False,
            "last_refresh_error":   None,
            "message":              "No SFP snapshot available yet for this slot",
        }

    last_success_at = max(
        (row.last_refresh_at for row in rows if row.last_refresh_at is not None),
        default=None,
    )

    sfp_list = [_row_to_dict(row) for row in rows]

    logger.info(
        "[CACHE-SFP] %d SFP chargés pour slot %s (instance #%s)",
        len(sfp_list),
        slot_short_id,
        instance_id,
    )

    return {
        "sfp":                  sfp_list,
        "sfp_count":            len(sfp_list),
        "slot_short_id":        slot_short_id,
        "last_success_at":      last_success_at,
        "last_refresh_at":      last_success_at,
        "last_refresh_success": True,
        "last_refresh_error":   None,
        "message":              "OK",
    }


def load_cached_sfp_port(
    db: Session,
    instance_id: int,
    port_id: str,
) -> Dict[str, Any]:
    """
    Charge le SFP d'un port_id logique (ex: "1/1/6/35") depuis la DB.
    """
    row = (
        db.query(ISAMSFPPort)
        .filter(
            ISAMSFPPort.isam_instance_id == instance_id,
            ISAMSFPPort.port_id          == port_id,
        )
        .first()
    )

    if not row:
        return {
            "sfp":     None,
            "found":   False,
            "port_id": port_id,
            "message": "No SFP data found. Run a SFP refresh first.",
        }

    return {
        "sfp":     _row_to_dict(row),
        "found":   True,
        "port_id": port_id,
        "message": "OK",
    }