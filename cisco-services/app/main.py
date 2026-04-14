import asyncio
import logging
from datetime import datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from app.api.v1.endpoints.cisco import router as cisco_router
from app.api.v1.endpoints.cisco_config_routes import router as cisco_config_router  # ← add this

from app.api.v1.endpoints.cisco import router as cisco_router
from app.core.config import settings
from app.core.db import Base, engine, SessionLocal
from app.models.cisco_switch import (
    CiscoSwitch,
    CiscoPortLock,
    CiscoVlan,
    CiscoPortAssignment,
    CiscoPortSnapshot,      # ← add this import
)
from app.services.cisco_client import (
    test_connection_for_switch,
    CiscoConnectionService,  # ← add this import
)

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


def _sync_ports_for_switch(db: Session, sw: CiscoSwitch) -> int:
    """
    Fetch live ports from a single switch and upsert into cisco_port_snapshots.
    Returns the number of ports synced, or -1 on failure.
    Runs synchronously — called from a thread pool via asyncio.to_thread().
    """
    try:
        service = CiscoConnectionService(sw)
        ok, proto, raw_ports, error = service.get_all_port_status(timeout=25)

        if not ok:
            logger.warning(
                "[PORT-SYNC] Switch %s (%s): could not fetch ports — %s",
                sw.name, sw.host, error,
            )
            return -1

        locks = {
            lock.port_label
            for lock in db.query(CiscoPortLock)
            .filter(CiscoPortLock.switch_id == sw.id)
            .all()
        }

        now = datetime.utcnow()
        for p in raw_ports:
            label = p["port_label"]
            snapshot = (
                db.query(CiscoPortSnapshot)
                .filter(
                    CiscoPortSnapshot.switch_id == sw.id,
                    CiscoPortSnapshot.port_label == label,
                )
                .first()
            )
            if snapshot:
                snapshot.port_number  = p.get("port_number", 0)
                snapshot.description  = p.get("description", "")
                snapshot.status       = p["status"]
                snapshot.vlan         = p.get("vlan", "")
                snapshot.duplex       = p.get("duplex", "")
                snapshot.speed        = p.get("speed", "")
                snapshot.port_type    = p.get("port_type", "")
                snapshot.mac_address  = p.get("mac_address")
                snapshot.last_seen_at = now
            else:
                snapshot = CiscoPortSnapshot(
                    switch_id    = sw.id,
                    port_label   = label,
                    port_number  = p.get("port_number", 0),
                    description  = p.get("description", ""),
                    status       = p["status"],
                    vlan         = p.get("vlan", ""),
                    duplex       = p.get("duplex", ""),
                    speed        = p.get("speed", ""),
                    port_type    = p.get("port_type", ""),
                    mac_address  = p.get("mac_address"),
                    last_seen_at = now,
                    created_at   = now,
                )
                db.add(snapshot)

        db.commit()
        logger.info(
            "[PORT-SYNC] Switch %s: synced %d ports (proto=%s).",
            sw.name, len(raw_ports), proto,
        )
        return len(raw_ports)

    except Exception as e:
        db.rollback()
        logger.error(
            "[PORT-SYNC] Switch %s: unexpected error — %s",
            sw.name, e, exc_info=True,
        )
        return -1


async def port_sync_loop(interval_seconds: int = 1800):
    """
    Every `interval_seconds` (default 30 min), fetch live port data
    from every known switch and upsert it into cisco_port_snapshots.

    - Runs each switch in a thread pool so blocking SSH/Telnet calls
      don't stall the event loop.
    - Existing snapshots are updated in-place; stale ports are kept so
      the UI always has something to show even if a switch is unreachable.
    - First run is delayed 60 s after startup to let the app warm up.
    """
    await asyncio.sleep(60)          # wait for app to be ready
    while True:
        logger.info("[PORT-SYNC] Starting background port sync for all switches.")
        db = SessionLocal()
        try:
            switches = db.query(CiscoSwitch).all()
            if not switches:
                logger.info("[PORT-SYNC] No switches configured, skipping.")
            else:
                # Build one coroutine per switch, each in its own thread
                # so SSH connections run truly in parallel.
                async def sync_one(sw: CiscoSwitch):
                    # Each thread gets its own DB session to avoid conflicts.
                    thread_db = SessionLocal()
                    try:
                        count = await asyncio.to_thread(
                            _sync_ports_for_switch, thread_db, sw
                        )
                        if count >= 0:
                            logger.info(
                                "[PORT-SYNC] ✓ %s — %d ports", sw.name, count
                            )
                        else:
                            logger.warning(
                                "[PORT-SYNC] ✗ %s — sync failed (switch may be unreachable)",
                                sw.name,
                            )
                    finally:
                        thread_db.close()

                await asyncio.gather(*[sync_one(sw) for sw in switches])

        except Exception:
            logger.exception("[PORT-SYNC] Unexpected error in port_sync_loop.")
        finally:
            db.close()

        logger.info(
            "[PORT-SYNC] Cycle complete. Next run in %d minutes.",
            interval_seconds // 60,
        )
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

    Base.metadata.create_all(bind=engine)
    seed_default_vlan()
    app.include_router(cisco_router, prefix="/api/v1")
    app.include_router(cisco_config_router, prefix="/api/v1")

    @app.get("/health", tags=["Health"])
    def health():
        return {"status": "ok", "service": settings.APP_NAME}

    @app.on_event("startup")
    async def startup_event():
        logger.info("Starting %s (%s)", settings.APP_NAME, settings.ENVIRONMENT)
        asyncio.create_task(health_check_loop(interval_seconds=900))
        asyncio.create_task(port_sync_loop(interval_seconds=1800))  # ← 30 min

    return app


app = create_app()