import asyncio
import logging
from datetime import datetime

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
from app.services.isam_connection import test_connection_for_instance
from app.services.isam_cache import refresh_isam_data_snapshot_for_instance
from app.services.isam_lt_cache import refresh_lt_slots_snapshot
from app.models.isam_lt_slot import ISAMLTSlot
from app.models.isam_lt_port import ISAMLTPort
from app.models.port_lock import PortLock
logger = logging.getLogger(__name__)


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


async def isam_data_refresh_loop(interval_seconds: int = 1800):
    """
    Refresh cache des commandes :
    - show port
    - show system memory-usage

    Toutes les 30 minutes.
    """
    await asyncio.sleep(8)
    while True:
        logger.info("[CACHE] Démarrage du refresh périodique des snapshots ISAM.")
        db: Session | None = None

        try:
            db = SessionLocal()
            instances = db.query(ISAMInstance).all()

            for inst in instances:
                try:
                    refresh_isam_data_snapshot_for_instance(db, inst)
                except Exception:
                    logger.exception(
                        f"[CACHE] Echec refresh data pour ISAM #{inst.id} ({inst.name})"
                    )
                    db.rollback()

        except Exception:
            logger.exception("[CACHE] Erreur globale pendant le refresh périodique.")
            if db:
                db.rollback()
        finally:
            if db:
                db.close()

        await asyncio.sleep(interval_seconds)


async def isam_lt_data_refresh_loop(interval_seconds: int = 21600):
    """
    Refresh cache des commandes LT SLOTS/PORTS :
    - show equipment slot | match exact:lt
    - show interface port pour chaque slot

    Toutes les 6 heures (21600 secondes).
    """
    await asyncio.sleep(8)
    while True:
        logger.info("[CACHE-6H] Démarrage du refresh périodique (LT slots + ports) - 6 heures.")
        db: Session | None = None

        try:
            db = SessionLocal()
            instances = db.query(ISAMInstance).all()

            for inst in instances:
                try:
                    # NEW: Refresh LT slots et ports (6h interval)
                    from app.services.isam_lt_cache import refresh_lt_slots_snapshot
                    refresh_lt_slots_snapshot(db, inst, timeout=30)
                    
                except Exception:
                    logger.exception(
                        f"[CACHE-6H] Echec refresh LT data pour ISAM #{inst.id} ({inst.name})"
                    )
                    db.rollback()

        except Exception:
            logger.exception("[CACHE-6H] Erreur globale pendant le refresh LT périodique.")
            if db:
                db.rollback()
        finally:
            if db:
                db.close()

        await asyncio.sleep(interval_seconds)

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
        asyncio.create_task(isam_data_refresh_loop(interval_seconds=1800))
        asyncio.create_task(isam_lt_data_refresh_loop(interval_seconds=21600))

    return app


app = create_app()