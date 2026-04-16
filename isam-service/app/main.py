# main.py
import asyncio
import logging
import time
from datetime import datetime, timedelta
from typing import Callable

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.api.v1.endpoints.isam import router as isam_router
from app.core.config import settings
from app.core.db import Base, engine, SessionLocal

# ── Models (create_all) ───────────────────────────────────────────────────────
from app.models.config_history import ConfigHistory          
from app.models.isam_data import ISAMData                    
from app.models.isam_instance import ISAMInstance
from app.models.isam_lt_port import ISAMLTPort               
from app.models.isam_lt_slot import ISAMLTSlot               
from app.models.isam_sfp_port import ISAMSFPPort             
from app.models.port_config import PortConfig                
from app.models.port_lock import PortLock                    
from app.models.template_project import TemplateProject      
from app.models.wan_template import WanTemplate              

# ── Services ──────────────────────────────────────────────────────────────────
from app.services.isam_cache import refresh_isam_data_snapshot_for_instance
from app.services.isam_connection import test_connection_for_instance
from app.services.isam_lt_cache import refresh_lt_slots_snapshot
from app.services.isam_sfp_cache import refresh_sfp_snapshot
from app.services.port_config_service import sync_ports_for_instance

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Timings
# ─────────────────────────────────────────────────────────────────────────────

# Health check
HEALTH_FIRST_RUN_DELAY_SECONDS  = 5
HEALTH_CHECK_INTERVAL_SECONDS   = 900  # 15 minutes

# Cache data (memory + ports)
DATA_FIRST_RUN_DELAY_SECONDS    = 60
DATA_REFRESH_INTERVAL_SECONDS   = 1800  # (non utilisé dans la nouvelle logique)

# LT slots + ports
LT_FIRST_RUN_DELAY_SECONDS      = 120
LT_REFRESH_INTERVAL_SECONDS     = 600   # (non utilisé)
LT_REFRESH_TIMEOUT_SECONDS      = 90    # augmenté si besoin de plus de temps

# Ports config (VLAN info flat)
PORTCFG_FIRST_RUN_DELAY_SECONDS   = 300
PORTCFG_REFRESH_INTERVAL_SECONDS  = 86400  # (non utilisé)
PORTCFG_REFRESH_TIMEOUT_SECONDS   = 25

# SFP transceiver
SFP_FIRST_RUN_DELAY_SECONDS     = 180
SFP_REFRESH_INTERVAL_SECONDS    = 3600  # (non utilisé)
SFP_REFRESH_TIMEOUT_SECONDS     = 30

# Retry commun (utilisé seulement par certaines boucles si besoin)
RETRY_ON_ERROR_SECONDS          = 300


# ─────────────────────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────────────────────

def configure_logging():
    logging.basicConfig(
        level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    )


# ─────────────────────────────────────────────────────────────────────────────
# Health-check loop (reste périodique toutes les 15 minutes)
# ─────────────────────────────────────────────────────────────────────────────

async def health_check_loop(
    *,
    first_delay_seconds: int = HEALTH_FIRST_RUN_DELAY_SECONDS,
    interval_seconds: int    = HEALTH_CHECK_INTERVAL_SECONDS,
):
    logger.info(
        "[HEALTH] Boucle démarrée. Première exécution dans %ss, "
        "puis toutes les %ss.",
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
        checked = ok_count = err_count = 0

        try:
            db = SessionLocal()
            instances = db.query(ISAMInstance).all()
            logger.info(
                "[HEALTH] %d instance(s) ISAM trouvée(s).",
                len(instances),
            )

            for inst in instances:
                checked += 1
                ok, proto, msg, duration_ms = test_connection_for_instance(inst)

                inst.last_checked_at       = datetime.utcnow()
                inst.last_response_time_ms = duration_ms

                if ok:
                    inst.status               = "active"
                    inst.health_protocol_used = proto
                    inst.last_error           = None
                    ok_count += 1
                else:
                    inst.status               = "error"
                    inst.health_protocol_used = None
                    inst.last_error           = msg
                    err_count += 1

                db.add(inst)

            db.commit()

        except Exception:
            logger.exception("[HEALTH] Erreur pendant le cycle #%s.", cycle_no)
            if db:
                db.rollback()
        finally:
            if db:
                db.close()

        elapsed = round(time.perf_counter() - cycle_started_at, 2)
        logger.info(
            "[HEALTH] Cycle #%s terminé en %ss. "
            "Vérifiées=%s OK=%s KO=%s. Prochain dans %ss.",
            cycle_no, elapsed, checked, ok_count, err_count, interval_seconds,
        )
        await asyncio.sleep(interval_seconds)


# ─────────────────────────────────────────────────────────────────────────────
# Generic multi-instance refresh runner (inchangé)
# ─────────────────────────────────────────────────────────────────────────────

def _run_refresh_for_all_instances(
    *,
    log_prefix:   str,
    start_message: str,
    refresh_func: Callable[[Session, ISAMInstance], None],
) -> bool:
    logger.info("%s %s", log_prefix, start_message)

    overall_success = True
    total = ok_count = err_count = 0
    started_at = time.perf_counter()

    db: Session | None = None
    instance_ids: list[int] = []

    try:
        db = SessionLocal()
        instance_ids = [r.id for r in db.query(ISAMInstance).all()]
        logger.info(
            "%s %d instance(s) trouvée(s).",
            log_prefix, len(instance_ids),
        )
    except Exception:
        logger.exception(
            "%s Erreur récupération liste instances.", log_prefix
        )
        return False
    finally:
        if db:
            db.close()

    for instance_id in instance_ids:
        total += 1
        db = None
        inst: ISAMInstance | None = None
        inst_started = time.perf_counter()

        try:
            db   = SessionLocal()
            inst = db.query(ISAMInstance).filter(
                ISAMInstance.id == instance_id
            ).first()

            if inst is None:
                logger.warning(
                    "%s Instance #%s introuvable.",
                    log_prefix, instance_id,
                )
                overall_success = False
                err_count += 1
                continue

            logger.info(
                "%s Début refresh instance #%s (%s) [%s].",
                log_prefix, inst.id, inst.name, inst.host,
            )

            refresh_func(db, inst)
            db.commit()

            inst_elapsed = round(time.perf_counter() - inst_started, 2)
            ok_count += 1
            logger.info(
                "%s Refresh OK instance #%s (%s) en %ss.",
                log_prefix, inst.id, inst.name, inst_elapsed,
            )

        except Exception:
            overall_success = False
            err_count += 1
            logger.exception(
                "%s Échec refresh instance #%s (%s).",
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
        "%s Cycle terminé en %ss. Total=%s OK=%s KO=%s.",
        log_prefix, total_elapsed, total, ok_count, err_count,
    )
    return overall_success


# ─────────────────────────────────────────────────────────────────────────────
# Refresh jobs (inchangés)
# ─────────────────────────────────────────────────────────────────────────────

# Cache data (memory + ports)
def run_isam_data_refresh_once() -> bool:
    return _run_refresh_for_all_instances(
        log_prefix    = "[CACHE-DATA]",
        start_message = "Refresh snapshots ISAM (memory + ports).",
        refresh_func  = refresh_isam_data_snapshot_for_instance,
    )


# LT slots + ports
def _refresh_lt_snapshot(db: Session, inst: ISAMInstance) -> None:
    refresh_lt_slots_snapshot(db, inst, timeout=LT_REFRESH_TIMEOUT_SECONDS)


def run_isam_lt_refresh_once() -> bool:
    return _run_refresh_for_all_instances(
        log_prefix    = "[CACHE-LT]",
        start_message = "Refresh LT slots + ports.",
        refresh_func  = _refresh_lt_snapshot,
    )


# Ports config (VLAN info flat)
def _refresh_ports_config_snapshot(db: Session, inst: ISAMInstance) -> None:
    ok, msg = sync_ports_for_instance(
        db,
        inst,
        force            = False,
        min_age_hours    = 24,
        port_id          = None,
        timeout          = PORTCFG_REFRESH_TIMEOUT_SECONDS,
        skip_port_types  = {"pon"},
    )
    if not ok:
        raise RuntimeError(msg)
    logger.info("[PORTCFG-SYNC] %s", msg)


def run_ports_config_sync_once() -> bool:
    return _run_refresh_for_all_instances(
        log_prefix    = "[PORTCFG-SYNC]",
        start_message = "Sync daily VLAN (configure bridge port ... info flat).",
        refresh_func  = _refresh_ports_config_snapshot,
    )


# SFP transceiver
def _refresh_sfp_snapshot(db: Session, inst: ISAMInstance) -> None:
    """
    Wrapper pour _run_refresh_for_all_instances.
    Le commit batch est géré DANS refresh_sfp_snapshot.
    """
    refresh_sfp_snapshot(
        db,
        inst,
        timeout           = SFP_REFRESH_TIMEOUT_SECONDS,
        commit_batch_size = 5,
    )


def run_sfp_refresh_once() -> bool:
    return _run_refresh_for_all_instances(
        log_prefix    = "[CACHE-SFP]",
        start_message = "Refresh SFP transceiver inventory.",
        refresh_func  = _refresh_sfp_snapshot,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Boucle générique quotidienne : 1er run rapide + 1 run/jour à heure fixe
# ─────────────────────────────────────────────────────────────────────────────

async def daily_refresh_loop(
    *,
    loop_name: str,
    run_once_func: Callable[[], bool],
    scheduled_hour: int,
    scheduled_minute: int,
    initial_delay_seconds: int,
):
    """
    Pattern:
      - attend initial_delay_seconds puis exécute run_once_func() une première fois
      - ensuite, exécute run_once_func() une fois par jour,
        à l'heure scheduled_hour:scheduled_minute (heure locale)
    """
    logger.info(
        "%s Boucle quotidienne démarrée. 1er refresh dans %ss, "
        "puis chaque jour vers %02d:%02d.",
        loop_name,
        initial_delay_seconds,
        scheduled_hour,
        scheduled_minute,
    )

    # 1) Premier refresh rapide après démarrage
    if initial_delay_seconds > 0:
        await asyncio.sleep(initial_delay_seconds)

    cycle_no = 0
    first_run = True

    while True:
        cycle_no += 1
        started_at = time.perf_counter()
        logger.info(
            "%s Cycle #%s démarré (%s).",
            loop_name,
            cycle_no,
            "initial" if first_run else "planifié",
        )

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
        logger.info(
            "%s Cycle #%s terminé (success=%s) en %ss.",
            loop_name,
            cycle_no,
            success,
            elapsed,
        )

        first_run = False

        # 2) Calculer l'heure du prochain run planifié
        now = datetime.now()
        target = now.replace(
            hour=scheduled_hour,
            minute=scheduled_minute,
            second=0,
            microsecond=0,
        )
        if target <= now:
            target += timedelta(days=1)

        delay = (target - now).total_seconds()
        logger.info(
            "%s Prochain cycle #%s prévu à %s (dans %ss).",
            loop_name,
            cycle_no + 1,
            target.isoformat(),
            int(delay),
        )

        await asyncio.sleep(delay)


# ─────────────────────────────────────────────────────────────────────────────
# Boucles spécifiques (quotidiennes, décalées de 30 minutes)
# ─────────────────────────────────────────────────────────────────────────────

async def isam_data_refresh_loop():
    # 1er run rapide après 60s, puis chaque jour vers 02:30
    await daily_refresh_loop(
        loop_name           = "[CACHE-DATA]",
        run_once_func       = run_isam_data_refresh_once,
        scheduled_hour      = 2,
        scheduled_minute    = 30,
        initial_delay_seconds = DATA_FIRST_RUN_DELAY_SECONDS,
    )


async def isam_lt_data_refresh_loop():
    # 1er run rapide après 120s, puis chaque jour vers 03:00
    await daily_refresh_loop(
        loop_name           = "[CACHE-LT]",
        run_once_func       = run_isam_lt_refresh_once,
        scheduled_hour      = 3,
        scheduled_minute    = 0,
        initial_delay_seconds = LT_FIRST_RUN_DELAY_SECONDS,
    )


async def isam_ports_config_sync_loop():
    # 1er run rapide après 300s, puis chaque jour vers 03:30
    await daily_refresh_loop(
        loop_name           = "[PORTCFG-SYNC]",
        run_once_func       = run_ports_config_sync_once,
        scheduled_hour      = 3,
        scheduled_minute    = 30,
        initial_delay_seconds = PORTCFG_FIRST_RUN_DELAY_SECONDS,
    )


async def isam_sfp_refresh_loop():
    # 1er run rapide après 180s, puis chaque jour vers 04:00
    await daily_refresh_loop(
        loop_name           = "[CACHE-SFP]",
        run_once_func       = run_sfp_refresh_once,
        scheduled_hour      = 4,
        scheduled_minute    = 0,
        initial_delay_seconds = SFP_FIRST_RUN_DELAY_SECONDS,
    )


# ─────────────────────────────────────────────────────────────────────────────
# App factory
# ─────────────────────────────────────────────────────────────────────────────

def create_app() -> FastAPI:
    configure_logging()
    logger.info("[APP] Initialisation de l'application FastAPI.")

    app = FastAPI(
        title       = settings.APP_NAME,
        version     = "1.0.0",
        description = "Microservice ISAM (multi-ISAM, Telnet/SSH, health-check, cache snapshots).",
    )

    origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://10.255.25.77:5173",
    ]

    app.add_middleware(
        CORSMiddleware,
        allow_origins     = origins,
        allow_credentials = True,
        allow_methods     = ["*"],
        allow_headers     = ["*"],
    )
    logger.info("[APP] CORS configuré pour %d origine(s).", len(origins))

    # Crée toutes les tables (y compris isam_sfp_ports)
    Base.metadata.create_all(bind=engine)
    logger.info("[APP] Base de données initialisée / schéma vérifié.")

    app.include_router(isam_router, prefix="/api/v1")
    logger.info("[APP] Router /api/v1 enregistré.")

    @app.get("/health", tags=["Health"])
    def health():
        return {"status": "ok", "environment": settings.ENVIRONMENT}

    @app.on_event("startup")
    async def startup_event():
        logger.info("[APP] Startup — lancement des tâches de fond.")

        # Health check reste périodique toutes les 15 min
        asyncio.create_task(
            health_check_loop(
                first_delay_seconds = HEALTH_FIRST_RUN_DELAY_SECONDS,
                interval_seconds    = HEALTH_CHECK_INTERVAL_SECONDS,
            )
        )

        # Caches : 1er run rapide + 1 run/jour à heure fixe, décalés de 30 min
        asyncio.create_task(isam_data_refresh_loop())        # 02:30
        asyncio.create_task(isam_lt_data_refresh_loop())     # 03:00
        asyncio.create_task(isam_ports_config_sync_loop())   # 03:30
        asyncio.create_task(isam_sfp_refresh_loop())         # 04:00

        logger.info(
            "[APP] Tâches démarrées : "
            "HEALTH(period=%ss) | "
            "CACHE-DATA(init=%ss, daily=02:30) | "
            "CACHE-LT(init=%ss, daily=03:00) | "
            "PORTCFG-SYNC(init=%ss, daily=03:30) | "
            "CACHE-SFP(init=%ss, daily=04:00).",
            HEALTH_CHECK_INTERVAL_SECONDS,
            DATA_FIRST_RUN_DELAY_SECONDS,
            LT_FIRST_RUN_DELAY_SECONDS,
            PORTCFG_FIRST_RUN_DELAY_SECONDS,
            SFP_FIRST_RUN_DELAY_SECONDS,
        )

    return app


app = create_app()