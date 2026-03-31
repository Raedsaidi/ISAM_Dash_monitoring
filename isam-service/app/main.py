import asyncio
import logging
from datetime import datetime
from typing import Callable

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.api.v1.endpoints.isam import router as isam_router
from app.core.config import settings
from app.core.db import Base, engine, SessionLocal
from app.models.isam_instance import ISAMInstance
from app.models.wan_template import WanTemplate
from app.models.config_history import ConfigHistory
from app.models.isam_data import ISAMData
from app.models.isam_lt_slot import ISAMLTSlot
from app.models.isam_lt_port import ISAMLTPort
from app.models.port_lock import PortLock
from app.services.isam_connection import test_connection_for_instance
from app.services.isam_cache import refresh_isam_data_snapshot_for_instance
from app.services.isam_lt_cache import refresh_lt_slots_snapshot

logger = logging.getLogger(__name__)

FIRST_RUN_DELAY_SECONDS = 60
DATA_REFRESH_INTERVAL_SECONDS = 1800
LT_REFRESH_INTERVAL_SECONDS = 360
RETRY_ON_ERROR_SECONDS = 300
LT_REFRESH_TIMEOUT_SECONDS = 30


def configure_logging():
    logging.basicConfig(
        level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    )


async def health_check_loop(interval_seconds: int = 900):
    await asyncio.sleep(5)

    while True:
        logger.info("[HEALTH] Démarrage du health-check périodique ISAM.")
        db: Session | None = None

        try:
            db = SessionLocal()
            instances = db.query(ISAMInstance).all()

            for inst in instances:
                ok, proto, msg, duration_ms = test_connection_for_instance(inst)
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

        except Exception:
            logger.exception("[HEALTH] Erreur pendant le health-check ISAM.")
            if db:
                db.rollback()
        finally:
            if db:
                db.close()

        await asyncio.sleep(interval_seconds)


def _run_refresh_for_all_instances(
    *,
    log_prefix: str,
    start_message: str,
    refresh_func: Callable[[Session, ISAMInstance], None],
) -> bool:
    logger.info(start_message)
    overall_success = True

    db: Session | None = None
    instance_ids: list[int] = []

    try:
        db = SessionLocal()
        instances = db.query(ISAMInstance).all()
        instance_ids = [inst.id for inst in instances]
    except Exception:
        logger.exception("%s Erreur lors de la récupération des instances ISAM.", log_prefix)
        return False
    finally:
        if db:
            db.close()

    for instance_id in instance_ids:
        db = None
        inst: ISAMInstance | None = None

        try:
            db = SessionLocal()
            inst = db.query(ISAMInstance).filter(ISAMInstance.id == instance_id).first()

            if inst is None:
                logger.warning("%s Instance ISAM #%s introuvable.", log_prefix, instance_id)
                overall_success = False
                continue

            refresh_func(db, inst)
            db.commit()

            logger.info("%s Refresh OK pour ISAM #%s (%s).", log_prefix, inst.id, inst.name)

        except Exception:
            overall_success = False
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

    return overall_success


def run_isam_data_refresh_once() -> bool:
    return _run_refresh_for_all_instances(
        log_prefix="[CACHE-30M]",
        start_message="[CACHE-30M] Démarrage du refresh périodique des snapshots ISAM (ports + memory usage).",
        refresh_func=refresh_isam_data_snapshot_for_instance,
    )


def _refresh_lt_snapshot(db: Session, inst: ISAMInstance) -> None:
    refresh_lt_slots_snapshot(db, inst, timeout=LT_REFRESH_TIMEOUT_SECONDS)


def run_isam_lt_refresh_once() -> bool:
    return _run_refresh_for_all_instances(
        log_prefix="[CACHE-1M]",
        start_message="[CACHE-1M] Démarrage du refresh périodique LT (slots + ports).",
        refresh_func=_refresh_lt_snapshot,
    )


async def periodic_refresh_loop(
    *,
    loop_name: str,
    run_once_func: Callable[[], bool],
    first_delay_seconds: int,
    success_interval_seconds: int,
    error_interval_seconds: int,
):
    logger.info(
        "%s Boucle démarrée. Première exécution dans %s secondes.",
        loop_name,
        first_delay_seconds,
    )

    await asyncio.sleep(first_delay_seconds)

    while True:
        try:
            success = await asyncio.to_thread(run_once_func)
        except Exception:
            success = False
            logger.exception("%s Erreur non gérée pendant l'exécution du cycle.", loop_name)

        next_delay = success_interval_seconds if success else error_interval_seconds

        if success:
            logger.info(
                "%s Cycle terminé avec succès. Prochaine exécution dans %s secondes.",
                loop_name,
                next_delay,
            )
        else:
            logger.warning(
                "%s Cycle terminé avec erreur. Nouvelle tentative dans %s secondes.",
                loop_name,
                next_delay,
            )

        await asyncio.sleep(next_delay)


async def isam_data_refresh_loop():
    await periodic_refresh_loop(
        loop_name="[CACHE-30M]",
        run_once_func=run_isam_data_refresh_once,
        first_delay_seconds=FIRST_RUN_DELAY_SECONDS,
        success_interval_seconds=DATA_REFRESH_INTERVAL_SECONDS,
        error_interval_seconds=RETRY_ON_ERROR_SECONDS,
    )


async def isam_lt_data_refresh_loop():
    await periodic_refresh_loop(
        loop_name="[CACHE-1m]",
        run_once_func=run_isam_lt_refresh_once,
        first_delay_seconds=FIRST_RUN_DELAY_SECONDS,
        success_interval_seconds=LT_REFRESH_INTERVAL_SECONDS,
        error_interval_seconds=RETRY_ON_ERROR_SECONDS,
    )


def create_app() -> FastAPI:
    configure_logging()

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

    Base.metadata.create_all(bind=engine)

    app.include_router(isam_router, prefix="/api/v1")

    @app.get("/health", tags=["Health"])
    def health():
        return {"status": "ok", "environment": settings.ENVIRONMENT}

    @app.on_event("startup")
    async def startup_event():
        asyncio.create_task(health_check_loop(interval_seconds=900))
        asyncio.create_task(isam_data_refresh_loop())
        asyncio.create_task(isam_lt_data_refresh_loop())

    return app


app = create_app()