import asyncio
import logging
from datetime import datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.api.v1.endpoints.cisco import router as cisco_router
from app.core.config import settings
from app.core.db import Base, engine, SessionLocal
from app.models.cisco_switch import (
    CiscoSwitch,
    CiscoPortLock,
    CiscoVlan,
    CiscoPortAssignment,
)
from app.services.cisco_client import test_connection_for_switch

logger = logging.getLogger(__name__)


def configure_logging():
    logging.basicConfig(
        level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    )


def seed_default_vlan():
    """Ensure VLAN 1 (default) exists."""
    db = SessionLocal()
    try:
        existing = db.query(CiscoVlan).filter(CiscoVlan.vlan_id == 1).first()
        if not existing:
            db.add(CiscoVlan(vlan_id=1, name="default", status="active"))
            db.commit()
            logger.info("Seeded default VLAN 1.")
    except Exception as e:
        logger.warning("Could not seed VLAN 1: %s", e)
        db.rollback()
    finally:
        db.close()


async def health_check_loop(interval_seconds: int = 900):
    await asyncio.sleep(10)
    while True:
        logger.info("[HEALTH] Starting periodic Cisco switch health check.")
        db = None
        try:
            db = SessionLocal()
            switches = db.query(CiscoSwitch).all()
            for sw in switches:
                try:
                    ok, proto, msg, duration_ms = test_connection_for_switch(sw)
                    sw.last_checked_at = datetime.utcnow()
                    sw.last_response_time_ms = duration_ms
                    if ok:
                        sw.status = "active"
                        sw.health_protocol_used = proto
                        sw.last_error = None
                    else:
                        sw.status = "error"
                        sw.health_protocol_used = None
                        sw.last_error = msg
                    db.add(sw)
                except Exception as e:
                    logger.error("[HEALTH] Error checking switch %s: %s", sw.name, e)
            db.commit()
        except Exception:
            logger.exception("[HEALTH] Error during health check loop.")
            if db:
                db.rollback()
        finally:
            if db:
                db.close()
        await asyncio.sleep(interval_seconds)


def create_app() -> FastAPI:
    configure_logging()

    app = FastAPI(
        title="Cisco Switch Management Service",
        description="Manage Cisco switches via SSH/Telnet with auto-fallback.",
        version="1.0.0",
    )

    origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://10.255.25.77:5173",
    ]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Create tables
    Base.metadata.create_all(bind=engine)

    # Seed
    seed_default_vlan()

    # Include router
    app.include_router(cisco_router, prefix="/api/v1")

    @app.get("/health", tags=["Health"])
    def health():
        return {"status": "ok", "service": settings.APP_NAME}

    @app.on_event("startup")
    async def startup_event():
        logger.info("Starting %s (%s)", settings.APP_NAME, settings.ENVIRONMENT)
        asyncio.create_task(health_check_loop(interval_seconds=900))

    return app


app = create_app()