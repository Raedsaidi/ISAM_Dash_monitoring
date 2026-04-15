"""
Cisco Switch Management Service — application entry point.
"""

import asyncio
import logging
from datetime import datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.api.v1.endpoints.cisco import router as cisco_router
from app.api.v1.endpoints.cisco_config_routes import router as cisco_config_router
from app.core.config import settings
from app.core.db import Base, engine, SessionLocal
from app.models.cisco_switch import (
    CiscoSwitch,
    CiscoVlan,
    CiscoPortLock,
    CiscoPortSnapshot,
    CiscoPortConfigHistory,
)
from app.services.cisco_client import (
    test_connection_for_switch,
    CiscoConnectionService,
)

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────────────────────


def configure_logging() -> None:
    logging.basicConfig(
        level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    )


# ─────────────────────────────────────────────────────────────────────────────
# Seeding
# ─────────────────────────────────────────────────────────────────────────────


def seed_default_vlan() -> None:
    db = SessionLocal()
    try:
        exists = db.query(CiscoVlan).filter(CiscoVlan.vlan_id == 1).first()
        if not exists:
            db.add(CiscoVlan(vlan_id=1, name="default", status="active"))
            db.commit()
            logger.info("[SEED] Seeded default VLAN 1.")
    except Exception as exc:
        logger.warning("[SEED] Could not seed VLAN 1: %s", exc)
        db.rollback()
    finally:
        db.close()


# ─────────────────────────────────────────────────────────────────────────────
# Verify the switch ORM object has the fields cisco_client.py expects
# ─────────────────────────────────────────────────────────────────────────────


def _verify_switch_fields(sw: CiscoSwitch) -> tuple[bool, str]:
    """
    cisco_client.py accesses sw.host, sw.ssh_port, sw.telnet_port,
    sw.username, sw.password, sw.enable_password, sw.protocol_preference.

    If your model uses password_encrypted instead of password,
    the CiscoConnectionService will get AttributeError and return nothing.

    This helper checks and logs exactly which fields are missing.
    """
    required = [
        "host", "ssh_port", "telnet_port",
        "username", "password",
        "protocol_preference",
    ]
    missing = [f for f in required if not hasattr(sw, f)]
    if missing:
        return False, f"Switch ORM missing fields: {missing}"

    # Also check the values are not None/empty
    empty = []
    for f in ["host", "username", "password"]:
        val = getattr(sw, f, None)
        if not val:
            empty.append(f)
    if empty:
        return False, f"Switch ORM has empty required fields: {empty}"

    return True, "ok"


# ─────────────────────────────────────────────────────────────────────────────
# Health-check loop
# ─────────────────────────────────────────────────────────────────────────────


async def health_check_loop(interval_seconds: int = 900) -> None:
    await asyncio.sleep(10)
    while True:
        logger.info("[HEALTH] Starting periodic health check.")
        db: Session | None = None
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
                except Exception as exc:
                    logger.error(
                        "[HEALTH] Error checking switch %s: %s", sw.name, exc
                    )
            db.commit()
        except Exception:
            logger.exception("[HEALTH] Unhandled error.")
            if db:
                db.rollback()
        finally:
            if db:
                db.close()
        await asyncio.sleep(interval_seconds)


# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 — Port snapshot sync
# ─────────────────────────────────────────────────────────────────────────────


def _sync_ports_for_switch(db: Session, sw: CiscoSwitch) -> list[str]:
    """
    SSH → fetch port list → upsert cisco_port_snapshots → COMMIT.
    Returns the list of port_labels now in the DB, or [] on failure.
    """
    # ── Guard: verify the ORM object has what cisco_client needs ─────────
    ok, reason = _verify_switch_fields(sw)
    if not ok:
        logger.error(
            "[PORT-SYNC] %s: cannot sync — %s. "
            "Check that CiscoSwitch model has a 'password' column "
            "(not 'password_encrypted').",
            sw.name, reason,
        )
        return []

    try:
        service = CiscoConnectionService(sw)
        ok, proto, raw_ports, error = service.get_all_port_status(timeout=25)

        if not ok:
            logger.warning(
                "[PORT-SYNC] %s: get_all_port_status failed — %s",
                sw.name, error,
            )
            return []

        if not raw_ports:
            logger.warning(
                "[PORT-SYNC] %s: connected OK but zero ports returned. "
                "Check parse_interfaces_status() output.",
                sw.name,
            )
            return []

        now = datetime.utcnow()
        synced_labels: list[str] = []

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
                db.add(CiscoPortSnapshot(
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
                ))
            synced_labels.append(label)

        db.commit()
        logger.info(
            "[PORT-SYNC] ✓ %s: %d port(s) saved to DB (proto=%s).",
            sw.name, len(synced_labels), proto,
        )
        return synced_labels

    except AttributeError as exc:
        # This fires when sw.password doesn't exist (model mismatch)
        db.rollback()
        logger.error(
            "[PORT-SYNC] %s: AttributeError — model field missing: %s. "
            "Your CiscoSwitch ORM model must have a plain 'password' "
            "column for CiscoConnectionService to work.",
            sw.name, exc,
        )
        return []

    except Exception as exc:
        db.rollback()
        logger.error(
            "[PORT-SYNC] %s: unexpected error — %s",
            sw.name, exc, exc_info=True,
        )
        return []


# ─────────────────────────────────────────────────────────────────────────────
# STEP 2 — Running-config sync
# ─────────────────────────────────────────────────────────────────────────────


def _sync_running_configs_for_switch(
    db: Session,
    sw: CiscoSwitch,
    port_labels: list[str],
    *,
    trigger: str = "background-sync",
) -> int:
    """
    For every port_label (already in DB from Step 1):
        SSH → show running-config interface <label>
        → write cisco_port_config_history row if text changed
        → COMMIT

    Returns new rows written, or -1 on hard failure.
    """
    if not port_labels:
        logger.info("[CFG-SYNC] %s: empty port list, skipping.", sw.name)
        return 0

    ok, reason = _verify_switch_fields(sw)
    if not ok:
        logger.error(
            "[CFG-SYNC] %s: cannot sync — %s", sw.name, reason
        )
        return -1

    try:
        service = CiscoConnectionService(sw)
        saved_count = 0
        now = datetime.utcnow()

        logger.info(
            "[CFG-SYNC] %s: fetching running config for %d port(s) "
            "(trigger=%s)…",
            sw.name, len(port_labels), trigger,
        )

        for port_label in port_labels:
            try:
                ok_cfg, proto, output, error = service.get_port_running_config(
                    port_label, timeout=15
                )

                if not ok_cfg or not output:
                    logger.debug(
                        "[CFG-SYNC] %s / %s: fetch failed — %s",
                        sw.name, port_label, error,
                    )
                    continue

                # Strip IOS shell noise so we compare only config lines
                clean_output = _strip_ios_noise(output, port_label)

                if not clean_output.strip():
                    logger.debug(
                        "[CFG-SYNC] %s / %s: output empty after "
                        "stripping IOS noise, skipping.",
                        sw.name, port_label,
                    )
                    continue

                # Only write when text has actually changed
                last = (
                    db.query(CiscoPortConfigHistory)
                    .filter(
                        CiscoPortConfigHistory.switch_id  == sw.id,
                        CiscoPortConfigHistory.port_label == port_label,
                    )
                    .order_by(CiscoPortConfigHistory.saved_at.desc())
                    .first()
                )

                if last and last.config_text.strip() == clean_output.strip():
                    logger.debug(
                        "[CFG-SYNC] %s / %s: unchanged, skipping.",
                        sw.name, port_label,
                    )
                    continue

                db.add(CiscoPortConfigHistory(
                    switch_id   = sw.id,
                    port_label  = port_label,
                    config_text = clean_output,
                    saved_by    = trigger,
                    saved_at    = now,
                ))
                saved_count += 1
                logger.debug(
                    "[CFG-SYNC] %s / %s: snapshot saved (trigger=%s).",
                    sw.name, port_label, trigger,
                )

            except Exception as port_exc:
                logger.warning(
                    "[CFG-SYNC] %s / %s: error — %s",
                    sw.name, port_label, port_exc,
                )

        db.commit()
        logger.info(
            "[CFG-SYNC] ✓ %s: %d / %d snapshot(s) written (trigger=%s).",
            sw.name, saved_count, len(port_labels), trigger,
        )
        return saved_count

    except Exception as exc:
        db.rollback()
        logger.error(
            "[CFG-SYNC] %s: unexpected error — %s",
            sw.name, exc, exc_info=True,
        )
        return -1


def _strip_ios_noise(raw: str, port_label: str) -> str:
    """
    Remove IOS shell artefacts from 'show running-config interface' output.

    Cisco interactive shell adds:
      - the echoed command line
      - 'terminal length 0' line
      - blank lines / prompt characters at the start and end

    We keep only lines that look like IOS config (start with a space,
    'interface', 'end', or '!').
    """
    lines = raw.splitlines()
    config_lines: list[str] = []
    in_config = False

    for line in lines:
        stripped = line.strip()

        # Start capturing when we hit the interface stanza
        if stripped.lower().startswith("interface"):
            in_config = True

        if in_config:
            # Stop at the next prompt-like line (ends with # or >)
            if stripped.endswith("#") or stripped.endswith(">"):
                break
            config_lines.append(line)

    return "\n".join(config_lines) if config_lines else raw


# ─────────────────────────────────────────────────────────────────────────────
# Combined pipeline for ONE switch
# ─────────────────────────────────────────────────────────────────────────────


def _full_sync_for_switch(
    sw: CiscoSwitch,
    *,
    trigger: str = "background-sync",
) -> tuple[int, int]:
    """
    Port sync → DB commit → Config fetch → DB commit.

    Two separate DB sessions guarantee Step 2 always sees Step 1's rows.

    Returns (ports_synced, configs_saved).
    ports_synced == -1  →  port fetch failed entirely.
    configs_saved == -1 →  config fetch failed entirely.
    """
    # ── Session A: port snapshots ─────────────────────────────────────────
    db_a = SessionLocal()
    try:
        port_labels = _sync_ports_for_switch(db_a, sw)
    finally:
        db_a.close()

    if not port_labels:
        return -1, 0

    # ── Session B: running configs ────────────────────────────────────────
    # Fresh session — guaranteed to see Session A's committed rows.
    db_b = SessionLocal()
    try:
        configs_saved = _sync_running_configs_for_switch(
            db_b, sw, port_labels, trigger=trigger
        )
    finally:
        db_b.close()

    return len(port_labels), configs_saved


# ─────────────────────────────────────────────────────────────────────────────
# Async orchestrator
# ─────────────────────────────────────────────────────────────────────────────


async def _run_full_sync_for_all_switches(
    trigger: str = "background-sync",
    *,
    require_active: bool = True,
) -> None:
    """
    Run the full pipeline for all matching switches concurrently.

    require_active=False  →  query ALL switches (used at startup before
                             health-check has marked anything active).
    require_active=True   →  only switches with status='active'
                             (used by the periodic loop).
    """
    logger.info(
        "[FULL-SYNC] Starting (trigger=%s, require_active=%s).",
        trigger, require_active,
    )

    db = SessionLocal()
    try:
        q = db.query(CiscoSwitch)
        if require_active:
            q = q.filter(CiscoSwitch.status == "active")
        switches = q.all()

        # Log what we found so silent-skip bugs are obvious
        logger.info(
            "[FULL-SYNC] Found %d switch(es) to process: %s",
            len(switches),
            [f"{s.name}({s.id})" for s in switches],
        )
    finally:
        db.close()

    if not switches:
        logger.warning(
            "[FULL-SYNC] No switches found — "
            "check the cisco_switches table is populated."
        )
        return

    async def _handle_one(sw: CiscoSwitch) -> None:
        logger.info(
            "[FULL-SYNC] → %s (id=%d, host=%s): "
            "port sync + config capture…",
            sw.name, sw.id, sw.host,
        )
        try:
            ports_synced, configs_saved = await asyncio.to_thread(
                _full_sync_for_switch, sw, trigger=trigger
            )
            if ports_synced < 0:
                logger.warning(
                    "[FULL-SYNC] ✗ %s: port sync failed — "
                    "check SSH credentials and connectivity.",
                    sw.name,
                )
            else:
                logger.info(
                    "[FULL-SYNC] ✓ %s: %d port(s) → DB | "
                    "%d config snapshot(s) → DB.",
                    sw.name, ports_synced, configs_saved,
                )
        except Exception as exc:
            logger.error(
                "[FULL-SYNC] ✗ %s: unhandled exception — %s",
                sw.name, exc, exc_info=True,
            )

    await asyncio.gather(*[_handle_one(sw) for sw in switches])
    logger.info("[FULL-SYNC] All switches done (trigger=%s).", trigger)


# ─────────────────────────────────────────────────────────────────────────────
# ONE-SHOT startup task
# ─────────────────────────────────────────────────────────────────────────────


async def startup_full_sync() -> None:
    """
    Runs ONCE at boot:
        1. Wait 5 s for uvicorn to finish binding.
        2. Query ALL switches (require_active=False — health-check hasn't
           run yet so status column is still whatever it was last session).
        3. For each switch: port sync → DB → config fetch → DB.

    saved_by column will contain "startup" so you can filter in the UI.
    """
    logger.info("[STARTUP-SYNC] Waiting 5 s for HTTP server to be ready…")
    await asyncio.sleep(5)

    logger.info("[STARTUP-SYNC] ═══ BEGIN startup full sync ═══")
    await _run_full_sync_for_all_switches(
        trigger="startup",
        require_active=False,   # ALL switches regardless of status column
    )
    logger.info("[STARTUP-SYNC] ═══ END startup full sync ═══")


# ─────────────────────────────────────────────────────────────────────────────
# Periodic loop
# ─────────────────────────────────────────────────────────────────────────────


async def port_and_config_sync_loop(interval_seconds: int = 1800) -> None:
    """
    Every 30 min run the full pipeline for all ACTIVE switches.
    Sleeps FIRST so the boot run is not duplicated.
    """
    logger.info(
        "[PERIODIC] port+config sync loop ready — "
        "first run in %d min.", interval_seconds // 60,
    )
    await asyncio.sleep(interval_seconds)
    while True:
        await _run_full_sync_for_all_switches(
            trigger="periodic",
            require_active=True,
        )
        logger.info(
            "[PERIODIC] Next run in %d min.", interval_seconds // 60
        )
        await asyncio.sleep(interval_seconds)


# ─────────────────────────────────────────────────────────────────────────────
# Application factory
# ─────────────────────────────────────────────────────────────────────────────


def create_app() -> FastAPI:
    configure_logging()

    app = FastAPI(
        title="Cisco Switch Management Service",
        description="Manage Cisco switches via SSH/Telnet with auto-fallback.",
        version="1.0.0",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:3000",
            "http://10.255.25.77:5173",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    Base.metadata.create_all(bind=engine)
    seed_default_vlan()

    app.include_router(cisco_router,        prefix="/api/v1")
    app.include_router(cisco_config_router, prefix="/api/v1")

    @app.get("/health", tags=["Health"])
    def health():
        return {"status": "ok", "service": settings.APP_NAME}

    @app.on_event("startup")
    async def startup_event() -> None:
        logger.info(
            "Starting %s (%s)", settings.APP_NAME, settings.ENVIRONMENT
        )
        asyncio.create_task(
            startup_full_sync(),
            name="startup-full-sync",
        )
        asyncio.create_task(
            health_check_loop(interval_seconds=900),
            name="health-check-loop",
        )
        asyncio.create_task(
            port_and_config_sync_loop(interval_seconds=1800),
            name="port-and-config-sync-loop",
        )

    return app


app = create_app()