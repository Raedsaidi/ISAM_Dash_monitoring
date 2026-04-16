# app/services/isam_transceiver.py
from __future__ import annotations

import logging
import re
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models.isam_instance import ISAMInstance
from app.models.isam_sfp_port import ISAMSFPPort
from app.services.isam_connection import ISAMConnectionService, ISAMPersistentTelnet
from app.services.isam_lt_slots_service import _PersistentSSHSession, _PersistentSSHLegacySession

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Tables standard → speed / direction / media
# ─────────────────────────────────────────────────────────────────────────────

_STANDARD_INFO: Dict[str, Dict[str, Optional[str]]] = {
    "1000base_bx10u": {
        "speed": "1 Gbps",
        "direction": "upstream",
        "tx_wavelength": "1310nm",
        "rx_wavelength": "1490nm",
        "media": "fiber",
    },
    "1000base_bx10d": {
        "speed": "1 Gbps",
        "direction": "downstream",
        "tx_wavelength": "1490nm",
        "rx_wavelength": "1310nm",
        "media": "fiber",
    },
    "10gbase_bxu": {
        "speed": "10 Gbps",
        "direction": "upstream",
        "tx_wavelength": "1270nm",
        "rx_wavelength": "1330nm",
        "media": "fiber",
    },
    "10gbase_bxd": {
        "speed": "10 Gbps",
        "direction": "downstream",
        "tx_wavelength": "1330nm",
        "rx_wavelength": "1270nm",
        "media": "fiber",
    },
    "1000base_t": {
        "speed": "1 Gbps",
        "direction": "bidirectional",
        "tx_wavelength": None,
        "rx_wavelength": None,
        "media": "copper",
    },
    "10gbase_t": {
        "speed": "10 Gbps",
        "direction": "bidirectional",
        "tx_wavelength": None,
        "rx_wavelength": None,
        "media": "copper",
    },
}

_NOT_AVAILABLE_VALUES = {
    "not-available", "not-applicable",
    "not_available", "not_applicable",
    "not available", "not applicable",
}


def _na(val: str) -> Optional[str]:
    """Retourne None si la valeur est not-available/not-applicable."""
    cleaned = (val or "").strip().strip('"').lower()
    return None if cleaned in _NOT_AVAILABLE_VALUES else val.strip().strip('"')


def _resolve_standard(standard: str) -> Dict[str, Optional[str]]:
    key = (standard or "").lower().strip()
    if key in _STANDARD_INFO:
        return dict(_STANDARD_INFO[key])
    return {
        "speed": None,
        "direction": None,
        "tx_wavelength": None,
        "rx_wavelength": None,
        "media": "fiber" if "bx" in key else None,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Parser lignes SFP
# Exemple de ligne :
#   lt:1/1/6:sfp:35  no-error  3FE66131AA  "1490.00 nm"  single-mode  1000base_bx10d
#   lt:1/1/8:sfp:5   cage-empty  not-available  not-available  not-available  not-available
#   lt:1/1/8:sfp:7   sfp-no-a2-supp  3FE28784AA  not-applicable  not-available  1000base_t
# ─────────────────────────────────────────────────────────────────────────────

# Regex robuste : tolère les espaces multiples et les guillemets dans wavelength
_LINE_RE = re.compile(
    r'^lt:(?P<slot_short>[\d/]+)'       # slot: 1/1/6
    r':sfp:(?P<idx>\d+)'                # sfp index
    r'\s+(?P<status>\S+)'               # no-error / cage-empty / sfp-no-a2-supp
    r'\s+(?P<part>\S+)'                 # part number
    r'\s+(?P<wave>"[^"]*"|\S+)'         # wavelength (avec ou sans guillemets)
    r'\s+(?P<fiber>\S+)'                # fiber_mode
    r'\s+(?P<std>\S+)',                 # standard
    re.IGNORECASE,
)


def _port_id_from_slot_and_index(slot_short: str, sfp_index: int) -> str:
    """
    Construit le port_id logique.
    slot_short = "1/1/6", sfp_index = 35  →  "1/1/6/35"
    """
    return f"{slot_short}/{sfp_index}"


def parse_transceiver_lines(raw: str) -> List[Dict[str, Any]]:
    """
    Parse la sortie CLI de :
        show equipment transceiver-inventory | match exact:<slot>

    Retourne une liste de dicts SFP normalisés.
    """
    results: List[Dict[str, Any]] = []
    seen: set[str] = set()

    for raw_line in raw.splitlines():
        # Nettoyage
        line = raw_line.replace("\r", "").strip()
        line = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", line)

        if not line.startswith("lt:"):
            continue

        # Normaliser les guillemets : "1490.00 nm" → "1490.00\x00nm"
        # pour que le split ne casse pas le contenu
        line_norm = re.sub(
            r'"([^"]*)"',
            lambda m: '"' + m.group(1).replace(" ", "\x00") + '"',
            line,
        )

        m = _LINE_RE.match(line_norm)
        if not m:
            logger.debug("[TRANSCEIVER] Ligne non matchée: %r", raw_line)
            continue

        slot_short = m.group("slot_short")
        sfp_index  = int(m.group("idx"))
        status     = m.group("status").lower().strip()
        part_raw   = m.group("part").replace("\x00", " ")
        wave_raw   = m.group("wave").replace("\x00", " ")
        fiber_raw  = m.group("fiber").replace("\x00", " ")
        std_raw    = m.group("std").replace("\x00", " ")

        port_id = _port_id_from_slot_and_index(slot_short, sfp_index)

        # Déduplique sur sfp_id
        sfp_id = f"lt:{slot_short}:sfp:{sfp_index}"
        if sfp_id in seen:
            continue
        seen.add(sfp_id)

        is_empty  = (status == "cage-empty")
        is_active = (status == "no-error")
        is_copper = (status == "sfp-no-a2-supp")

        part_number = _na(part_raw)
        wavelength  = _na(wave_raw)
        fiber_mode  = _na(fiber_raw)
        standard    = _na(std_raw)

        std_info = _resolve_standard(standard or "")

        # single-mode → force fiber si media pas encore défini
        if fiber_mode and "single" in fiber_mode.lower() and not std_info.get("media"):
            std_info["media"] = "fiber"

        results.append({
            "slot_id":       f"lt:{slot_short}",
            "slot_short_id": slot_short,
            "sfp_index":     sfp_index,
            "sfp_id":        sfp_id,
            "port_id":       port_id,        # "1/1/6/35"
            "status":        status,
            "is_empty":      is_empty,
            "is_active":     is_active,
            "is_copper":     is_copper,
            "part_number":   part_number,
            "wavelength":    wavelength,
            "fiber_mode":    fiber_mode,
            "standard":      standard,
            "speed":         std_info.get("speed"),
            "direction":     std_info.get("direction"),
            "media":         std_info.get("media"),
            "tx_wavelength": std_info.get("tx_wavelength"),
            "rx_wavelength": std_info.get("rx_wavelength"),
        })

    logger.debug("[TRANSCEIVER] parse_transceiver_lines → %d SFP", len(results))
    return results


def summarize_slot_sfp(sfp_list: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "total":     len(sfp_list),
        "active":    sum(1 for e in sfp_list if e["is_active"]),
        "empty":     sum(1 for e in sfp_list if e["is_empty"]),
        "copper":    sum(1 for e in sfp_list if e["is_copper"]),
        "fiber":     sum(1 for e in sfp_list if e.get("media") == "fiber"),
        "speeds":    sorted({e["speed"]    for e in sfp_list if e.get("speed")}),
        "standards": sorted({e["standard"] for e in sfp_list if e.get("standard")}),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Session helper (réutilise les classes de isam_lt_slots)
# ─────────────────────────────────────────────────────────────────────────────

def _open_best_session(
    instance: ISAMInstance,
    conn_service: ISAMConnectionService,
    timeout: int,
) -> Tuple[bool, Optional[str], Any, str]:
    """
    Ordre : SSH Paramiko → SSH legacy → Telnet
    Retourne (ok, protocol, session, message)
    """
    if instance.protocol_preference == "telnet":
        tel = ISAMPersistentTelnet(instance, timeout=timeout)
        ok, msg = tel.connect()
        return (ok, "telnet", tel, msg) if ok else (False, None, None, msg)

    # 1) SSH Paramiko
    ssh = _PersistentSSHSession(conn_service, timeout=timeout)
    ok, msg = ssh.connect()
    if ok:
        return True, "ssh", ssh, msg

    logger.warning("[TRANSCEIVER] SSH KO: %s → SSH legacy", msg)

    # 2) SSH legacy
    ssh_leg = _PersistentSSHLegacySession(instance, timeout=timeout)
    ok2, msg2 = ssh_leg.connect()
    if ok2:
        return True, "ssh-legacy", ssh_leg, msg2

    logger.warning("[TRANSCEIVER] SSH legacy KO: %s → Telnet", msg2)

    if instance.protocol_preference == "ssh":
        return False, None, None, f"SSH: {msg} | SSH-LEGACY: {msg2}"

    # 3) Telnet
    tel = ISAMPersistentTelnet(instance, timeout=timeout)
    ok3, msg3 = tel.connect()
    if ok3:
        return True, "telnet", tel, msg3

    return False, None, None, f"SSH: {msg} | SSH-LEGACY: {msg2} | TELNET: {msg3}"


# ─────────────────────────────────────────────────────────────────────────────
# DB upsert helpers
# ─────────────────────────────────────────────────────────────────────────────

def _upsert_sfp_rows(
    db: Session,
    instance_id: int,
    slot_short_id: str,
    sfp_entries: List[Dict[str, Any]],
) -> None:
    """
    Upsert des lignes ISAMSFPPort pour un slot donné.
    Stratégie : load existing → update or insert → flush
    """
    now = datetime.utcnow()

    # Charger les existants pour ce slot
    existing_rows: Dict[int, ISAMSFPPort] = {
        r.sfp_index: r
        for r in db.query(ISAMSFPPort).filter(
            ISAMSFPPort.isam_instance_id == instance_id,
            ISAMSFPPort.slot_short_id == slot_short_id,
        ).all()
    }

    seen_indexes = set()

    for entry in sfp_entries:
        idx = entry["sfp_index"]
        seen_indexes.add(idx)
        row = existing_rows.get(idx)

        if row is None:
            row = ISAMSFPPort(
                isam_instance_id=instance_id,
                slot_short_id=entry["slot_short_id"],
                slot_id=entry["slot_id"],
                sfp_index=idx,
                sfp_id=entry["sfp_id"],
                port_id=entry["port_id"],
                created_at=now,
            )
            db.add(row)

        # Mise à jour des champs
        row.status        = entry["status"]
        row.is_empty      = entry["is_empty"]
        row.is_active     = entry["is_active"]
        row.is_copper     = entry["is_copper"]
        row.part_number   = entry.get("part_number")
        row.wavelength    = entry.get("wavelength")
        row.fiber_mode    = entry.get("fiber_mode")
        row.standard      = entry.get("standard")
        row.speed         = entry.get("speed")
        row.direction     = entry.get("direction")
        row.media         = entry.get("media")
        row.tx_wavelength = entry.get("tx_wavelength")
        row.rx_wavelength = entry.get("rx_wavelength")
        row.last_refresh_at = now
        row.updated_at    = now

    # Supprimer les SFP qui n'existent plus dans le résultat CLI
    for idx, row in existing_rows.items():
        if idx not in seen_indexes:
            db.delete(row)

    db.flush()


# ─────────────────────────────────────────────────────────────────────────────
# Service principal
# ─────────────────────────────────────────────────────────────────────────────

class ISAMTransceiverService:
    """
    Service 3 — Transceiver inventory par port.

    - Pour chaque slot LT fourni, envoie :
        show equipment transceiver-inventory | match exact:<slot_short_id>
    - Parse chaque ligne SFP
    - Mappe le résultat sur le port_id logique (slot/index)
    - Persiste en DB dans isam_sfp_ports
    """

    def __init__(self, instance: ISAMInstance):
        self.instance     = instance
        self.conn_service = ISAMConnectionService(instance)

    # ── Fetch un slot ────────────────────────────────────────────────────────

    def _fetch_slot(
        self,
        session: Any,
        slot_short_id: str,
        timeout: int,
        idle_timeout: float,
        post_send_delay: float,
    ) -> Tuple[bool, str, str]:
        cmd = (
            f"show equipment transceiver-inventory "
            f"| match exact:{slot_short_id}"
        )
        logger.info("[TRANSCEIVER] Cmd slot=%s : %r", slot_short_id, cmd)

        ok, raw, err = session.execute(
            cmd,
            idle_timeout=idle_timeout,
            post_send_delay=post_send_delay,
        )

        if ok:
            logger.info(
                "[TRANSCEIVER] Slot %s → %d lignes",
                slot_short_id, len(raw.splitlines()),
            )
        else:
            logger.warning("[TRANSCEIVER] Slot %s → err: %s", slot_short_id, err)

        return ok, raw, err

    # ── Point d'entrée principal ─────────────────────────────────────────────

    def refresh_transceivers(
        self,
        db: Session,
        slot_short_ids: List[str],
        *,
        timeout: int = 30,
        idle_timeout: float = 5.0,
        post_send_delay: float = 1.5,
        inter_slot_delay: float = 0.8,
        persist: bool = True,
    ) -> Tuple[bool, str, Dict[str, Any]]:
        """
        Récupère + parse + persiste les SFP pour chaque slot.

        Retourne :
          (ok, message, result_dict)

        result_dict = {
            "protocol": str,
            "slots": {
                "1/1/6": {
                    "ok": bool,
                    "error": str | None,
                    "sfp": [ {sfp_entry}, ... ],
                    "summary": { total, active, empty, copper, fiber, ... },
                },
                ...
            }
        }
        """
        if not slot_short_ids:
            return False, "Aucun slot fourni", {}

        ok_open, protocol, session, conn_msg = _open_best_session(
            self.instance, self.conn_service, timeout
        )
        if not ok_open or session is None:
            logger.error("[TRANSCEIVER] Session impossible: %s", conn_msg)
            return False, conn_msg, {}

        logger.info(
            "[TRANSCEIVER] Session %s ouverte — instance #%s",
            protocol, self.instance.id,
        )

        result: Dict[str, Any] = {"protocol": protocol, "slots": {}}

        try:
            for idx, slot_short in enumerate(slot_short_ids):
                slot_short = slot_short.strip()
                if not slot_short:
                    continue

                if idx > 0:
                    time.sleep(inter_slot_delay)

                ok_cmd, raw, err = self._fetch_slot(
                    session, slot_short, timeout, idle_timeout, post_send_delay
                )

                sfp_entries: List[Dict[str, Any]] = []
                if ok_cmd and raw:
                    sfp_entries = parse_transceiver_lines(raw)

                summary = summarize_slot_sfp(sfp_entries)

                # Persister en DB
                if persist and ok_cmd:
                    try:
                        _upsert_sfp_rows(db, self.instance.id, slot_short, sfp_entries)
                        db.commit()
                    except Exception as e:
                        db.rollback()
                        logger.error(
                            "[TRANSCEIVER] Erreur upsert slot %s: %s", slot_short, e
                        )

                result["slots"][slot_short] = {
                    "ok":      ok_cmd,
                    "error":   err if not ok_cmd else None,
                    "sfp":     sfp_entries,
                    "summary": summary,
                }

                logger.info(
                    "[TRANSCEIVER] Slot %s → total=%d active=%d empty=%d copper=%d",
                    slot_short,
                    summary["total"], summary["active"],
                    summary["empty"], summary["copper"],
                )

        finally:
            try:
                session.close()
            except Exception:
                pass

        ok_slots  = sum(1 for v in result["slots"].values() if v["ok"])
        total_sfp = sum(v["summary"]["total"] for v in result["slots"].values())
        msg = (
            f"transceiver refresh: {ok_slots}/{len(slot_short_ids)} slots OK, "
            f"{total_sfp} SFP (proto={protocol})"
        )
        logger.info("[TRANSCEIVER] %s", msg)
        return True, msg, result

    # ── Lookup par port_id ───────────────────────────────────────────────────

    @staticmethod
    def get_sfp_for_port(
        db: Session,
        instance_id: int,
        port_id: str,
    ) -> Optional[ISAMSFPPort]:
        """
        Retourne le SFP correspondant au port_id logique (ex: "1/1/6/35").
        """
        return (
            db.query(ISAMSFPPort)
            .filter(
                ISAMSFPPort.isam_instance_id == instance_id,
                ISAMSFPPort.port_id == port_id,
            )
            .first()
        )

    @staticmethod
    def get_sfp_for_slot(
        db: Session,
        instance_id: int,
        slot_short_id: str,
    ) -> List[ISAMSFPPort]:
        """
        Retourne tous les SFP d'un slot (triés par index).
        """
        return (
            db.query(ISAMSFPPort)
            .filter(
                ISAMSFPPort.isam_instance_id == instance_id,
                ISAMSFPPort.slot_short_id == slot_short_id,
            )
            .order_by(ISAMSFPPort.sfp_index.asc())
            .all()
        )