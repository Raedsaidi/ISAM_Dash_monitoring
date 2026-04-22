import logging
from datetime import datetime

from sqlalchemy.orm import Session

from app.core.db import SessionLocal
from app.models.isam_instance import ISAMInstance
from app.services.isam_connection import test_connection_for_instance
from app.services.isam_cache import refresh_isam_data_snapshot_for_instance
from app.services.isam_lt_cache import refresh_lt_slots_snapshot

logger = logging.getLogger(__name__)

LT_REFRESH_TIMEOUT_SECONDS = 90


def bootstrap_new_isam_instance(instance_id: int) -> None:
    """
    Bootstrap initial d'une nouvelle instance ISAM :
      1. test de connexion / mise à jour du statut
      2. refresh snapshot général (memory + ports)
      3. refresh snapshot LT (slots + ports)

    Cette fonction ouvre sa propre session DB.
    """
    db: Session | None = None

    try:
        logger.info("[BOOTSTRAP] Démarrage bootstrap initial pour ISAM #%s", instance_id)

        db = SessionLocal()
        inst = db.query(ISAMInstance).filter(ISAMInstance.id == instance_id).first()

        if inst is None:
            logger.warning("[BOOTSTRAP] Instance ISAM #%s introuvable.", instance_id)
            return

        # ── 1) Health check initial ────────────────────────────────
        ok, proto, msg, duration_ms = test_connection_for_instance(inst, timeout=10)

        inst.last_checked_at = datetime.utcnow()
        inst.last_response_time_ms = duration_ms

        if ok:
            inst.status = "active"
            inst.health_protocol_used = proto
            inst.last_error = None
        else:
            inst.status = "error"
            inst.health_protocol_used = None
            inst.last_error = msg

        db.add(inst)
        db.commit()

        logger.info(
            "[BOOTSTRAP] Health-check initial terminé pour ISAM #%s (%s) : ok=%s, proto=%s",
            inst.id,
            inst.name,
            ok,
            proto,
        )

        # ── 2) Snapshot général (memory + ports) ───────────────────
        try:
            refresh_isam_data_snapshot_for_instance(db, inst)
            db.commit()
            logger.info(
                "[BOOTSTRAP] Snapshot général terminé pour ISAM #%s (%s).",
                inst.id,
                inst.name,
            )
        except Exception:
            db.rollback()
            logger.exception(
                "[BOOTSTRAP] Erreur snapshot général pour ISAM #%s (%s).",
                inst.id,
                inst.name,
            )

        # ── 3) Snapshot LT (slots + ports) ─────────────────────────
        try:
            refresh_lt_slots_snapshot(db, inst, timeout=LT_REFRESH_TIMEOUT_SECONDS)
            db.commit()
            logger.info(
                "[BOOTSTRAP] Snapshot LT terminé pour ISAM #%s (%s).",
                inst.id,
                inst.name,
            )
        except Exception:
            db.rollback()
            logger.exception(
                "[BOOTSTRAP] Erreur snapshot LT pour ISAM #%s (%s).",
                inst.id,
                inst.name,
            )

        logger.info(
            "[BOOTSTRAP] Bootstrap initial terminé pour ISAM #%s (%s).",
            inst.id,
            inst.name,
        )

    except Exception:
        if db:
            db.rollback()
        logger.exception(
            "[BOOTSTRAP] Erreur inattendue pendant le bootstrap de l'ISAM #%s",
            instance_id,
        )
    finally:
        if db:
            db.close()