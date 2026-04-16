from __future__ import annotations

import hashlib
import logging
import re
import socket
import time
from datetime import datetime, timedelta
from typing import Optional, Tuple

import paramiko
from sqlalchemy.orm import Session

from app.models.isam_instance import ISAMInstance
from app.models.isam_lt_port import ISAMLTPort
from app.models.port_config import PortConfig, PortConfigStatus
from app.services.isam_connection import ISAMConnectionService, ISAMPersistentTelnet

logger = logging.getLogger(__name__)

# Keep ONLY VLAN lines that contain vlan-id AND vlan-scope
VLAN_LINE_RE = re.compile(r"\bvlan-id\b.*\bvlan-scope\b", re.IGNORECASE)

# sernum SMBS:02A3D26B
ONT_SERNUM_RE = re.compile(r"\bsernum\s+([A-Za-z0-9]+:[A-Fa-f0-9]+)\b")

# Strict CLI error detection (avoid generic "error" word)
CLI_ERROR_PATTERNS = [
    re.compile(r"\binvalid token\b", re.IGNORECASE),
    re.compile(r"\bunknown command\b", re.IGNORECASE),
]


def _cleanup_output(text: str) -> str:
    """
    Normalize CLI output:
      - remove CR
      - remove control chars (bell etc.)
      - strip
    """
    if not text:
        return ""
    t = text.replace("\r", "")
    t = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", t)
    return t.strip()


def _looks_like_cli_error(output: str) -> bool:
    out = (output or "").lower()
    return any(p.search(out) for p in CLI_ERROR_PATTERNS)


def extract_vlan_lines(text: str) -> list[str]:
    """
    Extract VLAN lines from output of:
      configure bridge port X
      info flat
    We keep lines like:
      configure bridge port ... vlan-id ... vlan-scope ...
    """
    text = _cleanup_output(text)
    lines: list[str] = []

    for raw in (text or "").splitlines():
        line = " ".join(raw.strip().split())
        if not line:
            continue
        if line.lower().startswith("configure bridge port") and VLAN_LINE_RE.search(line):
            lines.append(line)

    lines.sort()
    return lines


def fingerprint(lines: list[str]) -> Optional[str]:
    if not lines:
        return None
    payload = "\n".join(lines).encode("utf-8", errors="ignore")
    return hashlib.sha256(payload).hexdigest()


def compute_status(expected_fp: Optional[str], device_lines: list[str], device_fp: Optional[str]) -> str:
    """
    Rules:
      - no vlan -> NOT_CONFIGURED
      - vlan present + expected match -> VIA_APP
      - vlan present + expected absent -> MANUAL
      - vlan present + expected different -> DRIFTED
    """
    if not device_lines:
        return PortConfigStatus.NOT_CONFIGURED.value

    if expected_fp:
        return PortConfigStatus.VIA_APP.value if (device_fp == expected_fp) else PortConfigStatus.DRIFTED.value

    return PortConfigStatus.MANUAL.value


def parse_ont_sernum(output: str) -> Optional[str]:
    output = _cleanup_output(output)
    m = ONT_SERNUM_RE.search(output or "")
    return m.group(1) if m else None


# =============================================================================
# Persistent SSH session (Paramiko shell)
# =============================================================================

class _PersistentSSHSession:
    """
    SSH persistent shell session using Paramiko, reusing ISAMConnectionService internal helpers.
    """

    def __init__(self, conn_service: ISAMConnectionService, timeout: int = 30):
        self.conn_service = conn_service
        self.instance = conn_service.instance
        self.timeout = timeout
        self.client: Optional[paramiko.SSHClient] = None
        self.chan: Optional[paramiko.Channel] = None
        self.connected = False

    def connect(self) -> Tuple[bool, str]:
        started = time.perf_counter()
        try:
            logger.info(
                "[SSH-PERSIST] Opening SSH session to %s:%s timeout=%ss",
                self.instance.host,
                self.instance.ssh_port,
                self.timeout,
            )

            self.client = self.conn_service._connect_ssh(timeout=self.timeout, legacy_algorithms=False)
            self.chan = self.conn_service._open_ssh_shell(self.client, timeout=self.timeout, read_delay=1.2)

            # flush banner/prompt
            try:
                _ = self.conn_service._read_shell_output(self.chan, timeout=2, idle_timeout=0.8)
            except Exception:
                pass

            self.connected = True
            elapsed = round(time.perf_counter() - started, 2)
            logger.info("[SSH-PERSIST] Session opened in %ss", elapsed)
            return True, "OK"

        except Exception as e:
            self.close()
            logger.warning("[SSH-PERSIST] Open failed: %s", e)
            return False, str(e)

    def execute(self, command: str, idle_timeout: float = 3.0, post_send_delay: float = 1.0) -> Tuple[bool, str, str]:
        if not self.connected or not self.chan or self.chan.closed:
            return False, "", "[SSH-PERSIST] Not connected."

        try:
            # flush buffer
            try:
                self.conn_service._drain_shell(self.chan, max_seconds=0.5)
            except Exception:
                pass

            out_parts: list[str] = []
            prompt_re = self.conn_service._make_prompt_re()

            for line in (command or "").splitlines():
                line = line.strip()
                if not line:
                    continue

                self.chan.send(line + "\n")
                time.sleep(0.10)

                raw = self.conn_service._read_shell_output_until_prompt(
                    self.chan,
                    timeout=self.timeout,
                    idle_no_prompt=max(8.0, idle_timeout),
                    prompt_re=prompt_re,
                )
                out_parts.append(raw)

            time.sleep(post_send_delay)

            output = "".join(out_parts)
            cleaned = self.conn_service._sanitize_command_output(output, command)
            return True, cleaned, ""

        except Exception as e:
            self.connected = False
            return False, "", f"[SSH-PERSIST] Execute failed: {e}"

    def close(self):
        try:
            if self.chan and not self.chan.closed:
                self.chan.close()
        except Exception:
            pass
        try:
            if self.client:
                self.client.close()
        except Exception:
            pass
        self.client = None
        self.chan = None
        self.connected = False


# =============================================================================
# Apply success -> save expected fingerprint
# =============================================================================

def record_apply_success(
    db: Session,
    *,
    instance_id: int,
    port_id: str,
    template_id: Optional[int],
    username: str,
    template_commands: list[str],
) -> None:
    """
    Call AFTER apply success=True.
    Store EXPECTED fingerprint in ports_config.
    """
    expected_lines = extract_vlan_lines("\n".join(template_commands))
    expected_fp = fingerprint(expected_lines)
    now = datetime.utcnow()

    row = (
        db.query(PortConfig)
        .filter(PortConfig.isam_instance_id == instance_id, PortConfig.port_id == port_id)
        .first()
    )
    if not row:
        row = PortConfig(
            isam_instance_id=instance_id,
            port_id=port_id,
            created_at=now,
            updated_at=now,
            status=PortConfigStatus.UNKNOWN.value,
        )
        db.add(row)

    row.last_template_id = template_id
    row.last_applied_by = username
    row.last_applied_at = now
    row.apply_count = (row.apply_count or 0) + 1

    row.expected_vlan_lines = expected_lines or []
    row.expected_vlan_fingerprint = expected_fp
    row.updated_at = now


# =============================================================================
# Sync ports for instance
# =============================================================================

def sync_ports_for_instance(
    db: Session,
    inst: ISAMInstance,
    *,
    force: bool = False,
    min_age_hours: int = 24,
    port_id: Optional[str] = None,
    timeout: int = 25,
    skip_port_types: set[str] | None = None,
    commit_batch_size: int = 5,           # commit each 5 ports
    log_each_command: bool = True,        # logs per command
    output_preview_chars: int = 450,      # preview output length
) -> Tuple[bool, str]:
    """
    Sync ports_config by reading equipment:

    VLAN command:
      - normal ports: configure bridge port <port_id>
      - ONT ports:    configure bridge port <port_id>/1/1
      then: info flat

    ONT command (only if port_type == ont):
      configure equipment ont interface <port_id>
      info flat

    Protocol order:
      1) SSH persistent
      2) Telnet persistent
      3) Non-persistent strategy (execute_command_preference)

    Also fixes:
      - duplicates in isam_lt_ports (dedupe port_id)
      - ObjectDeletedError by fetching tuples (port_id, port_type)
      - commit batch
    """
    skip_port_types = skip_port_types or {"pon"}

    # -------------------------
    # Load ports as tuples (port_id, port_type)
    # avoids ObjectDeletedError if LT refresh deletes rows during sync
    # -------------------------
    q = db.query(ISAMLTPort.port_id, ISAMLTPort.port_type).filter(ISAMLTPort.isam_instance_id == inst.id)
    if port_id:
        q = q.filter(ISAMLTPort.port_id == port_id)

    raw_ports: list[tuple[str, str]] = q.all()

    # -------------------------
    # Deduplicate by port_id (your DB has duplicates)
    # Priority: ont > ethernet-line > xdsl-line > pon
    # -------------------------
    priority = {"ont": 3, "ethernet-line": 2, "xdsl-line": 1, "pon": 0}
    uniq: dict[str, str] = {}  # port_id -> best port_type

    for pid, ptype in raw_ports:
        pid = (pid or "").strip()
        ptype = (ptype or "").strip().lower()
        if not pid:
            continue

        cur = uniq.get(pid)
        if not cur:
            uniq[pid] = ptype
        else:
            if priority.get(ptype, 0) > priority.get(cur, 0):
                uniq[pid] = ptype

    ports: list[tuple[str, str]] = list(uniq.items())

    now = datetime.utcnow()
    min_age = timedelta(hours=min_age_hours)

    logger.info(
        "[PORTCFG] Sync start instance=%s host=%s ports(raw=%s uniq=%s) force=%s batch=%s",
        inst.id, inst.host, len(raw_ports), len(ports), force, commit_batch_size
    )

    # -------------------------
    # Preload existing ports_config rows (avoid duplicate inserts)
    # -------------------------
    port_ids = [pid for (pid, _) in ports]
    cfg_map: dict[str, PortConfig] = {}
    if port_ids:
        cfg_rows = (
            db.query(PortConfig)
            .filter(PortConfig.isam_instance_id == inst.id, PortConfig.port_id.in_(port_ids))
            .all()
        )
        cfg_map = {r.port_id: r for r in cfg_rows}

    # -------------------------
    # Open SSH persistent first
    # -------------------------
    conn = ISAMConnectionService(inst)

    ssh = _PersistentSSHSession(conn, timeout=timeout)
    use_ssh, ssh_msg = ssh.connect()
    if use_ssh:
        logger.info("[PORTCFG] Using SSH persistent for instance=%s", inst.id)
    else:
        logger.warning("[PORTCFG] SSH persistent unavailable for instance=%s: %s", inst.id, ssh_msg)

    # fallback telnet
    telnet: ISAMPersistentTelnet | None = None
    use_telnet = False
    if not use_ssh:
        try:
            telnet = ISAMPersistentTelnet(inst, timeout=timeout)
            ok_tel, msg_tel = telnet.connect()
            use_telnet = ok_tel
            logger.info("[PORTCFG] Telnet persistent connect ok=%s msg=%s", ok_tel, msg_tel)
        except Exception as e:
            use_telnet = False
            logger.warning("[PORTCFG] Telnet persistent unavailable: %s", e)

    def _exec_with_timing(cmd: str) -> tuple[bool, str, str, float, str]:
        """
        Returns: ok, out, err, elapsed_s, protocol
        """
        started = time.perf_counter()

        if use_ssh and ssh.connected:
            ok, out, err = ssh.execute(cmd, idle_timeout=3.0, post_send_delay=1.0)
            proto = "ssh"
        elif use_telnet and telnet and telnet.connected:
            ok, out, err = telnet.execute(cmd, idle_timeout=3.0, post_send_delay=1.0)
            proto = "telnet"
        else:
            ok, proto2, out, err = conn.execute_command_preference(cmd, timeout=timeout)
            proto = proto2 or "unknown"

        elapsed = round(time.perf_counter() - started, 3)
        out = out or ""
        err = err or ""

        # detect CLI errors printed in stdout
        if ok and _looks_like_cli_error(out):
            ok = False
            err = (err + " | " if err else "") + "CLI error detected in output"

        return ok, out, err, elapsed, proto

    def _log_cmd(port: str, label: str, cmd: str, ok: bool, elapsed: float, proto: str, out: str, err: str):
        if not log_each_command:
            return
        preview = _cleanup_output(out)[:output_preview_chars]
        logger.info(
            "[PORTCFG-CMD] port=%s label=%s proto=%s ok=%s time=%ss cmd=%r preview=%r err=%r",
            port,
            label,
            proto,
            ok,
            elapsed,
            cmd,
            preview,
            (err[:250] if err else ""),
        )

    ok_count = 0
    err_count = 0
    skipped = 0
    ont_checked = 0
    ont_found = 0
    processed = 0

    def commit_batch_if_needed(final: bool = False):
        nonlocal processed
        if commit_batch_size <= 0:
            return
        if final or (processed > 0 and processed % commit_batch_size == 0):
            db.commit()
            logger.info("[PORTCFG] Batch commit (%s/%s)", processed, len(ports))

    try:
        for base_port, pt in ports:
            pt = (pt or "").strip().lower()

            if pt in skip_port_types:
                skipped += 1
                continue

            row = cfg_map.get(base_port)
            if not row:
                row = PortConfig(
                    isam_instance_id=inst.id,
                    port_id=base_port,
                    created_at=now,
                    updated_at=now,
                    status=PortConfigStatus.UNKNOWN.value,
                )
                db.add(row)
                cfg_map[base_port] = row

            # skip recent
            if not force and row.last_device_check_at and (now - row.last_device_check_at) < min_age:
                continue

            # -----------------------
            # ONT info flat
            # -----------------------
            if pt == "ont":
                ont_cmd = f"configure equipment ont interface {base_port}\ninfo flat"
                ont_checked += 1

                ok_ont, out_ont, err_ont, t_ont, proto_ont = _exec_with_timing(ont_cmd)
                _log_cmd(base_port, "ONT", ont_cmd, ok_ont, t_ont, proto_ont, out_ont, err_ont)

                row.ont_last_check_at = now
                row.ont_last_check_success = 1 if ok_ont else 0
                row.ont_last_check_error = None if ok_ont else (err_ont or "ONT info flat failed")

                if ok_ont:
                    cleaned_ont = _cleanup_output(out_ont)
                    row.ont_raw_output = cleaned_ont
                    sn = parse_ont_sernum(cleaned_ont)
                    if sn:
                        row.ont_sernum = sn
                        ont_found += 1
                # if fail: do not wipe ont_sernum

            # -----------------------
            # VLAN info flat
            # MODIF: si port_type == ont => ajouter /1/1 à la commande VLAN
            # -----------------------
            vlan_port = base_port
            if pt == "ont":
                if not vlan_port.endswith("/1/1"):
                    vlan_port = f"{vlan_port}/1/1"

            vlan_cmd = f"configure bridge port {vlan_port}\ninfo flat"
            ok_vlan, out_vlan, err_vlan, t_vlan, proto_vlan = _exec_with_timing(vlan_cmd)
            _log_cmd(base_port, "VLAN", vlan_cmd, ok_vlan, t_vlan, proto_vlan, out_vlan, err_vlan)

            row.last_device_check_at = now
            row.last_device_check_success = 1 if ok_vlan else 0
            row.last_device_check_error = None if ok_vlan else (err_vlan or "VLAN info flat failed")

            if ok_vlan:
                cleaned_vlan = _cleanup_output(out_vlan)
                device_lines = extract_vlan_lines(cleaned_vlan)
                device_fp = fingerprint(device_lines)

                row.device_raw_output = cleaned_vlan
                row.device_vlan_lines = device_lines
                row.device_vlan_fingerprint = device_fp

                row.status = compute_status(row.expected_vlan_fingerprint, device_lines, device_fp)
                ok_count += 1
            else:
                # keep last status if exists
                if not row.status:
                    row.status = PortConfigStatus.UNKNOWN.value
                err_count += 1

            row.updated_at = now

            processed += 1
            commit_batch_if_needed(final=False)

        commit_batch_if_needed(final=True)

    finally:
        try:
            ssh.close()
        except Exception:
            pass
        try:
            if telnet:
                telnet.close()
        except Exception:
            pass

    logger.info(
        "[PORTCFG] Sync end instance=%s ok=%s err=%s skipped=%s ont_checked=%s ont_found=%s processed=%s",
        inst.id, ok_count, err_count, skipped, ont_checked, ont_found, processed
    )

    return True, (
        f"sync done: ok={ok_count}, err={err_count}, skipped={skipped}, "
        f"ont_checked={ont_checked}, ont_found={ont_found}, processed={processed}"
    )