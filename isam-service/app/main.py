import asyncio
import logging
import time
from datetime import datetime
from typing import Callable

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.api.v1.endpoints.isam import router as isam_router
from app.core.config import settings
from app.core.db import Base, engine, SessionLocal
from app.models.config_history import ConfigHistory
from app.models.isam_data import ISAMData
from app.models.isam_instance import ISAMInstance
from app.models.isam_lt_port import ISAMLTPort
from app.models.isam_lt_slot import ISAMLTSlot
from app.models.port_lock import PortLock
from app.models.template_project import TemplateProject
from app.models.wan_template import WanTemplate
from app.services.isam_cache import refresh_isam_data_snapshot_for_instance
from app.services.isam_connection import test_connection_for_instance
from app.services.isam_lt_cache import refresh_lt_slots_snapshot

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────
# Timings
# ─────────────────────────────────────────────────────────────

HEALTH_FIRST_RUN_DELAY_SECONDS = 5
HEALTH_CHECK_INTERVAL_SECONDS = 900

DATA_FIRST_RUN_DELAY_SECONDS = 60
DATA_REFRESH_INTERVAL_SECONDS = 1800

LT_FIRST_RUN_DELAY_SECONDS = 120
LT_REFRESH_INTERVAL_SECONDS = 600

RETRY_ON_ERROR_SECONDS = 300
LT_REFRESH_TIMEOUT_SECONDS = 30


# ─────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────

def configure_logging():
    logging.basicConfig(
        level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    )


# ─────────────────────────────────────────────────────────────
# Health-check loop
# ─────────────────────────────────────────────────────────────

async def health_check_loop(
    *,
    first_delay_seconds: int = HEALTH_FIRST_RUN_DELAY_SECONDS,
    interval_seconds: int = HEALTH_CHECK_INTERVAL_SECONDS,
):
    logger.info(
        "[HEALTH] Boucle démarrée. Première exécution dans %s secondes, puis toutes les %s secondes.",
        first_delay_seconds,
        interval_seconds,
    )

    await asyncio.sleep(first_delay_seconds)

    cycle_no = 0

    while True:
        cycle_no += 1
        cycle_started_at = time.perf_counter()

        logger.info("[HEALTH] Cycle #%s démarré.", cycle_no)

        db: Session | None = None
        checked_count = 0
        success_count = 0
        error_count = 0

        try:
            db = SessionLocal()
            instances = db.query(ISAMInstance).all()

            logger.info(
                "[HEALTH] %d instance(s) ISAM trouvée(s) pour health-check.",
                len(instances),
            )

            for inst in instances:
                checked_count += 1
                logger.info(
                    "[HEALTH] Test connexion ISAM #%s (%s) [%s].",
                    inst.id,
                    inst.name,
                    inst.host,
                )

                ok, proto, msg, duration_ms = test_connection_for_instance(inst)

                inst.last_checked_at = datetime.utcnow()
                inst.last_response_time_ms = duration_ms

                if ok:
                    inst.status = "active"
                    inst.health_protocol_used = proto
                    inst.last_error = None
                    success_count += 1

                    logger.info(
                        "[HEALTH] OK ISAM #%s (%s) -> proto=%s, %sms",
                        inst.id,
                        inst.name,
                        proto,
                        duration_ms,
                    )
                else:
                    inst.status = "error"
                    inst.health_protocol_used = None
                    inst.last_error = msg
                    error_count += 1

                    logger.warning(
                        "[HEALTH] ECHEC ISAM #%s (%s) -> %s",
                        inst.id,
                        inst.name,
                        msg,
                    )

                db.add(inst)

            db.commit()

        except Exception:
            logger.exception("[HEALTH] Erreur pendant le cycle de health-check.")
            if db:
                db.rollback()
        finally:
            if db:
                db.close()

        elapsed = round(time.perf_counter() - cycle_started_at, 2)

        logger.info(
            "[HEALTH] Cycle #%s terminé en %ss. Vérifiées=%s, OK=%s, KO=%s. Prochain cycle dans %s secondes.",
            cycle_no,
            elapsed,
            checked_count,
            success_count,
            error_count,
            interval_seconds,
        )

        await asyncio.sleep(interval_seconds)


# ─────────────────────────────────────────────────────────────
# Generic multi-instance refresh runner
# ─────────────────────────────────────────────────────────────

def _run_refresh_for_all_instances(
    *,
    log_prefix: str,
    start_message: str,
    refresh_func: Callable[[Session, ISAMInstance], None],
) -> bool:
    logger.info("%s %s", log_prefix, start_message)

    overall_success = True
    total_count = 0
    success_count = 0
    error_count = 0

    db: Session | None = None
    instance_ids: list[int] = []

    started_at = time.perf_counter()

    try:
        db = SessionLocal()
        instances = db.query(ISAMInstance).all()
        instance_ids = [inst.id for inst in instances]

        logger.info(
            "%s %d instance(s) ISAM trouvée(s) pour ce cycle.",
            log_prefix,
            len(instance_ids),
        )

    except Exception:
        logger.exception(
            "%s Erreur lors de la récupération de la liste des instances ISAM.",
            log_prefix,
        )
        return False
    finally:
        if db:
            db.close()

    for instance_id in instance_ids:
        total_count += 1
        db = None
        inst: ISAMInstance | None = None
        instance_started_at = time.perf_counter()

        try:
            db = SessionLocal()
            inst = db.query(ISAMInstance).filter(ISAMInstance.id == instance_id).first()

            if inst is None:
                logger.warning(
                    "%s Instance ISAM #%s introuvable au moment du refresh.",
                    log_prefix,
                    instance_id,
                )
                overall_success = False
                error_count += 1
                continue

            logger.info(
                "%s Début refresh pour ISAM #%s (%s) [%s].",
                log_prefix,
                inst.id,
                inst.name,
                inst.host,
            )

            refresh_func(db, inst)
            db.commit()

            instance_elapsed = round(time.perf_counter() - instance_started_at, 2)
            success_count += 1

            logger.info(
                "%s Refresh OK pour ISAM #%s (%s) en %ss.",
                log_prefix,
                inst.id,
                inst.name,
                instance_elapsed,
            )

        except Exception:
            overall_success = False
            error_count += 1

            logger.exception(
                "%s Echec refresh pour ISAM #%s (%s).",
                log_prefix,
                instance_id,
                inst.name if inst else "unknown",
            )

            if db:
                db.rollback()

        finally:
            if db:
                db.close()

    total_elapsed = round(time.perf_counter() - started_at, 2)

    logger.info(
        "%s Cycle multi-instance terminé en %ss. Total=%s, OK=%s, KO=%s.",
        log_prefix,
        total_elapsed,
        total_count,
        success_count,
        error_count,
    )

    return overall_success


# ─────────────────────────────────────────────────────────────
# Refresh jobs
# ─────────────────────────────────────────────────────────────

def run_isam_data_refresh_once() -> bool:
    return _run_refresh_for_all_instances(
        log_prefix="[CACHE-DATA]",
        start_message="Démarrage du refresh périodique des snapshots ISAM (memory usage + ports).",
        refresh_func=refresh_isam_data_snapshot_for_instance,
    )


def _refresh_lt_snapshot(db: Session, inst: ISAMInstance) -> None:
    refresh_lt_slots_snapshot(db, inst, timeout=LT_REFRESH_TIMEOUT_SECONDS)


def run_isam_lt_refresh_once() -> bool:
    return _run_refresh_for_all_instances(
        log_prefix="[CACHE-LT]",
        start_message="Démarrage du refresh périodique LT (slots + ports).",
        refresh_func=_refresh_lt_snapshot,
    )


# ─────────────────────────────────────────────────────────────
# Generic periodic loop
# ─────────────────────────────────────────────────────────────

async def periodic_refresh_loop(
    *,
    loop_name: str,
    run_once_func: Callable[[], bool],
    first_delay_seconds: int,
    success_interval_seconds: int,
    error_interval_seconds: int,
):
    logger.info(
        "%s Boucle démarrée. Première exécution dans %s secondes. Intervalle succès=%ss, intervalle erreur=%ss.",
        loop_name,
        first_delay_seconds,
        success_interval_seconds,
        error_interval_seconds,
    )

    await asyncio.sleep(first_delay_seconds)

    cycle_no = 0

    while True:
        cycle_no += 1
        started_at = time.perf_counter()

        logger.info("%s Cycle #%s démarré.", loop_name, cycle_no)

        try:
            success = await asyncio.to_thread(run_once_func)
        except Exception:
            success = False
            logger.exception(
                "%s Erreur non gérée pendant le cycle #%s.",
                loop_name,
                cycle_no,
            )

        elapsed = round(time.perf_counter() - started_at, 2)
        next_delay = success_interval_seconds if success else error_interval_seconds

        if success:
            logger.info(
                "%s Cycle #%s terminé avec succès en %ss. Prochaine exécution dans %s secondes.",
                loop_name,
                cycle_no,
                elapsed,
                next_delay,
            )
        else:
            logger.warning(
                "%s Cycle #%s terminé en erreur après %ss. Nouvelle tentative dans %s secondes.",
                loop_name,
                cycle_no,
                elapsed,
                next_delay,
            )

        await asyncio.sleep(next_delay)


# ─────────────────────────────────────────────────────────────
# Specific loops
# ─────────────────────────────────────────────────────────────

async def isam_data_refresh_loop():
    await periodic_refresh_loop(
        loop_name="[CACHE-DATA]",
        run_once_func=run_isam_data_refresh_once,
        first_delay_seconds=DATA_FIRST_RUN_DELAY_SECONDS,
        success_interval_seconds=DATA_REFRESH_INTERVAL_SECONDS,
        error_interval_seconds=RETRY_ON_ERROR_SECONDS,
    )


async def isam_lt_data_refresh_loop():
    await periodic_refresh_loop(
        loop_name="[CACHE-LT]",
        run_once_func=run_isam_lt_refresh_once,
        first_delay_seconds=LT_FIRST_RUN_DELAY_SECONDS,
        success_interval_seconds=LT_REFRESH_INTERVAL_SECONDS,
        error_interval_seconds=RETRY_ON_ERROR_SECONDS,
    )


# ─────────────────────────────────────────────────────────────
# App factory
# ─────────────────────────────────────────────────────────────

def create_app() -> FastAPI:
    configure_logging()

    logger.info("[APP] Initialisation de l'application FastAPI.")

    app = FastAPI(
        title=settings.APP_NAME,
        version="1.0.0",
        description="Microservice ISAM (multi-ISAM, Telnet/SSH, health-check, cache snapshots).",
    )

    origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://10.255.25.77:5173",
    ]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    logger.info("[APP] CORS configuré pour %d origine(s).", len(origins))

    Base.metadata.create_all(bind=engine)
    logger.info("[APP] Base de données initialisée / schéma vérifié.")

    app.include_router(isam_router, prefix="/api/v1")
    logger.info("[APP] Router API /api/v1 enregistré.")

    @app.get("/health", tags=["Health"])
    def health():
        return {"status": "ok", "environment": settings.ENVIRONMENT}

    @app.on_event("startup")
    async def startup_event():
        logger.info("[APP] Startup event déclenché. Lancement des tâches de fond...")

        asyncio.create_task(
            health_check_loop(
                first_delay_seconds=HEALTH_FIRST_RUN_DELAY_SECONDS,
                interval_seconds=HEALTH_CHECK_INTERVAL_SECONDS,
            )
        )

        asyncio.create_task(isam_data_refresh_loop())
        asyncio.create_task(isam_lt_data_refresh_loop())

        logger.info(
            "[APP] Tâches démarrées : HEALTH(delay=%ss), CACHE-DATA(delay=%ss), CACHE-LT(delay=%ss).",
            HEALTH_FIRST_RUN_DELAY_SECONDS,
            DATA_FIRST_RUN_DELAY_SECONDS,
            LT_FIRST_RUN_DELAY_SECONDS,
        )

    return app


app = create_app()