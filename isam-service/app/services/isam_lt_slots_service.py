import logging
import re
import select
import shutil
import subprocess
import time
from typing import Tuple, Optional, List, Dict, Any

from app.services.isam_connection import (
    ISAMConnectionService,
    ISAMPersistentTelnet,
    Protocol,
)
from app.models.isam_instance import ISAMInstance

logger = logging.getLogger(__name__)

ALLOWED_PORT_TYPES = {"xdsl-line", "ethernet-line", "pon", "ont"}


class _PersistentSSHSession:
    """
    Session SSH persistante basée sur Paramiko shell interactif.
    """

    def __init__(self, conn_service: ISAMConnectionService, timeout: int = 30):
        self.conn_service = conn_service
        self.instance = conn_service.instance
        self.timeout = timeout
        self.client = None
        self.chan = None
        self.protocol: Protocol = "ssh"
        self.connected = False

    def connect(self) -> Tuple[bool, str]:
        started_at = time.perf_counter()

        try:
            logger.info(
                "[SSH-PERSIST] Ouverture session démarrée vers %s:%s (timeout=%ss).",
                self.instance.host,
                self.instance.ssh_port,
                self.timeout,
            )

            self.client = self.conn_service._connect_ssh(
                timeout=self.timeout,
                legacy_algorithms=False,
            )
            self.chan = self.conn_service._open_ssh_shell(
                self.client,
                timeout=self.timeout,
                read_delay=1.2,
            )

            try:
                _ = self.conn_service._read_shell_output(
                    self.chan,
                    timeout=2,
                    idle_timeout=0.8,
                )
            except Exception:
                pass

            self.connected = True
            elapsed = round(time.perf_counter() - started_at, 2)

            logger.info(
                "[SSH-PERSIST] Session ouverte avec succès vers %s:%s en %ss.",
                self.instance.host,
                self.instance.ssh_port,
                elapsed,
            )
            return True, "[SSH-PERSIST] Session ouverte avec succès."

        except Exception as e:
            self.close()
            elapsed = round(time.perf_counter() - started_at, 2)
            msg = f"[SSH-PERSIST] Échec connexion : {e}"
            logger.exception(
                "[SSH-PERSIST] Échec ouverture session vers %s:%s après %ss : %s",
                self.instance.host,
                self.instance.ssh_port,
                elapsed,
                e,
            )
            return False, msg

    def execute(
        self,
        command: str,
        idle_timeout: float = 3.0,
        post_send_delay: float = 1.0,
    ) -> Tuple[bool, str, str]:
        if not self.connected or not self.chan:
            return False, "", "[SSH-PERSIST] Session non connectée."

        started_at = time.perf_counter()

        try:
            try:
                _ = self.conn_service._read_shell_output(
                    self.chan,
                    timeout=1,
                    idle_timeout=0.5,
                )
            except Exception:
                pass

            logger.info(
                "[SSH-PERSIST] Exécution commande démarrée vers %s:%s (idle_timeout=%ss, post_send_delay=%ss): %r",
                self.instance.host,
                self.instance.ssh_port,
                idle_timeout,
                post_send_delay,
                command,
            )

            for line in command.split("\n"):
                line = line.strip()
                if not line:
                    continue

                if self.chan.closed:
                    self.connected = False
                    return False, "", "[SSH-PERSIST] Channel fermé avant envoi."

                self.chan.send(line + "\n")
                time.sleep(0.35)

            time.sleep(post_send_delay)

            if self.chan.closed:
                self.connected = False
                return False, "", "[SSH-PERSIST] Channel fermé après envoi."

            output = self.conn_service._read_shell_output(
                self.chan,
                timeout=self.timeout,
                idle_timeout=idle_timeout,
            )
            cleaned = self.conn_service._sanitize_command_output(output, command)

            elapsed = round(time.perf_counter() - started_at, 2)
            logger.info(
                "[SSH-PERSIST] Commande terminée vers %s:%s en %ss (output=%d chars).",
                self.instance.host,
                self.instance.ssh_port,
                elapsed,
                len(cleaned),
            )
            return True, cleaned, ""

        except Exception as e:
            self.connected = False
            elapsed = round(time.perf_counter() - started_at, 2)
            msg = f"[SSH-PERSIST] Erreur exécution : {e}"
            logger.exception(
                "[SSH-PERSIST] Erreur exécution commande vers %s:%s après %ss : %s",
                self.instance.host,
                self.instance.ssh_port,
                elapsed,
                e,
            )
            return False, "", msg

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

        self.chan = None
        self.client = None
        self.connected = False

        logger.info(
            "[SSH-PERSIST] Session fermée pour %s:%s.",
            self.instance.host,
            self.instance.ssh_port,
        )


class _PersistentSSHLegacySession:
    """
    Session SSH legacy persistante via OpenSSH + sshpass + shell interactif (-tt).
    """

    def __init__(self, instance: ISAMInstance, timeout: int = 30):
        self.instance = instance
        self.timeout = timeout
        self.proc: Optional[subprocess.Popen] = None
        self.protocol: Protocol = "ssh-legacy"
        self.connected = False

    @staticmethod
    def _sshpass_available() -> bool:
        return shutil.which("sshpass") is not None

    @staticmethod
    def _openssh_available() -> bool:
        return shutil.which("ssh") is not None

    def connect(self) -> Tuple[bool, str]:
        started_at = time.perf_counter()

        if not self._openssh_available():
            msg = "[SSH-LEGACY-PERSIST] Le binaire 'ssh' est introuvable."
            logger.error(msg)
            return False, msg

        if not self._sshpass_available():
            msg = "[SSH-LEGACY-PERSIST] Le binaire 'sshpass' est introuvable."
            logger.error(msg)
            return False, msg

        try:
            logger.info(
                "[SSH-LEGACY-PERSIST] Ouverture session démarrée vers %s:%s (timeout=%ss).",
                self.instance.host,
                self.instance.ssh_port,
                self.timeout,
            )

            cmd = [
                "sshpass",
                "-p",
                self.instance.password,
                "ssh",
                "-tt",
                "-o",
                "HostKeyAlgorithms=+ssh-rsa",
                "-o",
                "PubkeyAcceptedAlgorithms=+ssh-rsa",
                "-o",
                "KexAlgorithms=+diffie-hellman-group14-sha1",
                "-o",
                "StrictHostKeyChecking=no",
                "-o",
                "UserKnownHostsFile=/dev/null",
                "-o",
                "PreferredAuthentications=password",
                "-o",
                "PubkeyAuthentication=no",
                "-o",
                f"ConnectTimeout={self.timeout}",
                "-p",
                str(self.instance.ssh_port),
                f"{self.instance.username}@{self.instance.host}",
            ]

            self.proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )

            if self.proc.stdin is None or self.proc.stdout is None or self.proc.stderr is None:
                raise RuntimeError("Impossible d'ouvrir le process SSH legacy persistant")

            time.sleep(2.0)

            collected_out = ""
            collected_err = ""
            end_time = time.time() + self.timeout

            while time.time() < end_time:
                if self.proc.poll() is not None:
                    break

                ready, _, _ = select.select([self.proc.stdout, self.proc.stderr], [], [], 0.5)
                for stream in ready:
                    chunk = stream.read()
                    if not chunk:
                        continue
                    if stream is self.proc.stdout:
                        collected_out += chunk
                    else:
                        collected_err += chunk

                if collected_out or collected_err:
                    break

            if self.proc.poll() is not None and not (collected_out or collected_err):
                raise RuntimeError("Le process SSH legacy s'est fermé immédiatement")

            self.connected = True
            elapsed = round(time.perf_counter() - started_at, 2)

            logger.info(
                "[SSH-LEGACY-PERSIST] Session ouverte avec succès vers %s:%s en %ss.",
                self.instance.host,
                self.instance.ssh_port,
                elapsed,
            )
            return True, "[SSH-LEGACY-PERSIST] Session ouverte avec succès."

        except Exception as e:
            self.close()
            elapsed = round(time.perf_counter() - started_at, 2)
            msg = f"[SSH-LEGACY-PERSIST] Échec connexion : {e}"
            logger.exception(
                "[SSH-LEGACY-PERSIST] Échec ouverture session vers %s:%s après %ss : %s",
                self.instance.host,
                self.instance.ssh_port,
                elapsed,
                e,
            )
            return False, msg

    def execute(
        self,
        command: str,
        idle_timeout: float = 3.0,
        post_send_delay: float = 1.0,
    ) -> Tuple[bool, str, str]:
        if not self.connected or not self.proc:
            return False, "", "[SSH-LEGACY-PERSIST] Session non connectée."

        if self.proc.stdin is None or self.proc.stdout is None or self.proc.stderr is None:
            self.connected = False
            return False, "", "[SSH-LEGACY-PERSIST] Flux process indisponibles."

        started_at = time.perf_counter()

        try:
            logger.info(
                "[SSH-LEGACY-PERSIST] Exécution commande démarrée vers %s:%s (idle_timeout=%ss, post_send_delay=%ss): %r",
                self.instance.host,
                self.instance.ssh_port,
                idle_timeout,
                post_send_delay,
                command,
            )

            try:
                ready, _, _ = select.select([self.proc.stdout, self.proc.stderr], [], [], 0.2)
                for stream in ready:
                    _ = stream.read()
            except Exception:
                pass

            for line in command.split("\n"):
                line = line.strip()
                if not line:
                    continue

                if self.proc.poll() is not None:
                    self.connected = False
                    return False, "", "[SSH-LEGACY-PERSIST] Process fermé avant envoi."

                self.proc.stdin.write(line + "\n")
                self.proc.stdin.flush()
                time.sleep(0.35)

            time.sleep(post_send_delay)

            end_time = time.time() + self.timeout
            last_data_time = time.time()
            collected_out = ""
            collected_err = ""

            while time.time() < end_time:
                if self.proc.poll() is not None:
                    try:
                        out_rest, err_rest = self.proc.communicate(timeout=1)
                    except Exception:
                        out_rest, err_rest = "", ""
                    collected_out += out_rest or ""
                    collected_err += err_rest or ""
                    self.connected = False
                    break

                ready, _, _ = select.select([self.proc.stdout, self.proc.stderr], [], [], 0.2)

                got_data = False
                for stream in ready:
                    chunk = stream.read()
                    if not chunk:
                        continue
                    got_data = True
                    if stream is self.proc.stdout:
                        collected_out += chunk
                    else:
                        collected_err += chunk

                if got_data:
                    last_data_time = time.time()
                else:
                    if (collected_out or collected_err) and (time.time() - last_data_time) > idle_timeout:
                        break

            cleaned_out = (collected_out or "").replace("\r", "").strip()
            cleaned_err = (collected_err or "").replace("\r", "").strip()

            elapsed = round(time.perf_counter() - started_at, 2)
            logger.info(
                "[SSH-LEGACY-PERSIST] Commande terminée vers %s:%s en %ss (stdout=%d chars, stderr=%d chars).",
                self.instance.host,
                self.instance.ssh_port,
                elapsed,
                len(cleaned_out),
                len(cleaned_err),
            )
            return True, cleaned_out, cleaned_err

        except Exception as e:
            self.connected = False
            elapsed = round(time.perf_counter() - started_at, 2)
            msg = f"[SSH-LEGACY-PERSIST] Erreur exécution : {e}"
            logger.exception(
                "[SSH-LEGACY-PERSIST] Erreur exécution commande vers %s:%s après %ss : %s",
                self.instance.host,
                self.instance.ssh_port,
                elapsed,
                e,
            )
            return False, "", msg

    def close(self):
        if self.proc:
            try:
                if self.proc.stdin:
                    try:
                        self.proc.stdin.write("exit\n")
                        self.proc.stdin.flush()
                    except Exception:
                        pass
                self.proc.terminate()
            except Exception:
                pass

        self.proc = None
        self.connected = False

        logger.info(
            "[SSH-LEGACY-PERSIST] Session fermée pour %s:%s.",
            self.instance.host,
            self.instance.ssh_port,
        )


class ISAMLTSlotsService:
    """
    Service pour récupérer les slots LT et leurs ports respectifs.

    STRATÉGIE :
      1) session persistante SSH
      2) session persistante SSH legacy
      3) session persistante Telnet

    Au lieu d'envoyer N commandes ports par slot, on envoie UNE commande globale :
        show interface port
    puis on répartit les ports dans les slots par port_id.
    """

    def __init__(self, instance: ISAMInstance):
        self.instance = instance
        self.conn_service = ISAMConnectionService(instance)

    @staticmethod
    def _port_belongs_to_slot(port_id: str, slot_short_id: str) -> bool:
        expected_prefix = slot_short_id + "/"
        return port_id.startswith(expected_prefix)

    @staticmethod
    def _extract_slot_from_port_id(port_id: str, known_slot_short_ids: List[str]) -> Optional[str]:
        sorted_slots = sorted(known_slot_short_ids, key=len, reverse=True)
        for slot_short in sorted_slots:
            if port_id.startswith(slot_short + "/"):
                return slot_short
        return None

    def get_lt_slots(
        self,
        timeout: int = 30,
    ) -> Tuple[bool, Optional[Protocol], str, List[Dict[str, Any]], str]:
        script = "show equipment slot | match exact:lt:"
        logger.info(
            "[LT_SLOTS] >>> Récupération des slots LT pour instance #%s (%s)",
            self.instance.id,
            self.instance.name,
        )

        try:
            success, protocol_used, raw_output, err_msg = self.conn_service.execute_command_preference(
                command=script,
                timeout=timeout,
            )

            if not success:
                logger.error(
                    "[LT_SLOTS] !!! Impossible de récupérer les slots LT pour instance #%s : %s",
                    self.instance.id,
                    err_msg,
                )
                return False, protocol_used, raw_output or "", [], err_msg

            slots = self._parse_lt_slots(raw_output or "")
            logger.info(
                "[LT_SLOTS] %d slots LT parsés pour instance #%s.",
                len(slots),
                self.instance.id,
            )

            if not slots:
                msg = "Aucun slot LT parsé"
                logger.warning("[LT_SLOTS] %s", msg)
                return False, protocol_used, raw_output or "", [], msg

            return True, protocol_used, raw_output or "", slots, "OK"

        except Exception as e:
            msg = f"[LT_SLOTS] Erreur inattendue : {e}"
            logger.exception(msg)
            return False, None, "", [], msg

    @staticmethod
    def _parse_lt_slots(raw_output: str) -> List[Dict[str, Any]]:
        slots: List[Dict[str, Any]] = []

        logger.info("[LT_SLOTS] Démarrage parsing des slots LT (on ignore vlt:)")

        for line_orig in raw_output.splitlines():
            line = line_orig.replace("\r", "").strip()
            if not line:
                continue

            if not line.startswith("lt:"):
                continue

            parts = line.split()
            if len(parts) < 5:
                logger.debug("[LT_SLOTS] Ligne slot non reconnue (trop courte) : %r", line_orig)
                continue

            raw_slot_id = parts[0]
            board_type = parts[1]
            equipped = parts[2]
            alarm_state = parts[3]
            admin_state = parts[4]

            if ":" in raw_slot_id:
                slot_short = raw_slot_id.split(":", 1)[1]
            else:
                slot_short = raw_slot_id

            slot_dict: Dict[str, Any] = {
                "slot_id": raw_slot_id,
                "slot_short_id": slot_short,
                "board": board_type,
                "admin_state": admin_state,
                "link_state": equipped,
                "port_state": alarm_state,
                "cfg_mtu": 0,
                "oper_mtu": 0,
                "lag_bndl": "-",
                "mode": "-",
                "encap": "-",
                "port_type": "lt",
            }

            slots.append(slot_dict)

        logger.info("[LT_SLOTS] Fin parsing slots LT : %d slots parsés", len(slots))
        return slots

    def get_slot_ports(
        self,
        slot_id: str,
        slot_short_id: str,
        timeout: int = 30,
    ) -> Tuple[bool, Optional[Protocol], str, List[Dict[str, Any]], str]:
        script = f"show interface port | match exact:{slot_short_id}"

        logger.info(
            "[LT_PORTS] >>> Récupération des ports pour slot %s (short=%s)",
            slot_id,
            slot_short_id,
        )

        try:
            success, protocol_used, raw_output, err_msg = self.conn_service.execute_command_preference(
                command=script,
                timeout=timeout,
            )

            if not success:
                logger.error("[LT_PORTS] Impossible de récupérer les ports du slot %s : %s", slot_id, err_msg)
                return False, protocol_used, raw_output or "", [], err_msg

            ports = self._parse_slot_ports(raw_output or "", slot_id, slot_short_id)
            logger.info(
                "[LT_PORTS] %d ports parsés pour slot %s",
                len(ports),
                slot_id,
            )
            return True, protocol_used, raw_output or "", ports, "OK"

        except Exception as e:
            msg = f"[LT_PORTS] Erreur inattendue pour slot {slot_id} : {e}"
            logger.exception(msg)
            return False, None, "", [], msg

    @staticmethod
    def _parse_slot_ports(
        raw_output: str,
        slot_id: str,
        slot_short_id: str,
    ) -> List[Dict[str, Any]]:
        ports: List[Dict[str, Any]] = []
        skipped_wrong_slot = 0
        skipped_wrong_type = 0

        for line_orig in raw_output.splitlines():
            clean_line = line_orig.replace("\r", "")
            clean_line = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", clean_line)
            stripped = clean_line.strip()
            if not stripped:
                continue

            m = re.search(
                r"(xdsl-line|ethernet-line|pon|ont):(\d+/\d+/\d+/\d+)\s+(\S+)(?:\s+(\S+))?",
                 stripped
    )
            if not m:
                continue

            port_type = m.group(1)
            port_id = m.group(2)
            admin_state = m.group(3)
            oper_state = m.group(4) if m.group(4) else admin_state

            if port_type not in ALLOWED_PORT_TYPES:
                skipped_wrong_type += 1
                continue

            if not ISAMLTSlotsService._port_belongs_to_slot(port_id, slot_short_id):
                skipped_wrong_slot += 1
                continue

            port_dict: Dict[str, Any] = {
                "port_id": port_id,
                "slot_id": slot_id,
                "port_type": port_type,
                "admin_state": admin_state,
                "link_state": oper_state,
                "port_state": oper_state,
                "cfg_mtu": 0,
                "oper_mtu": 0,
                "lag_bndl": "-",
                "mode": "-",
                "encap": "-",
                "board": "LT",
                "raw_line": stripped,
                "slot_short_id": slot_short_id,
            }

            ports.append(port_dict)

        if skipped_wrong_slot > 0:
            logger.warning(
                "[LT_PORTS] Slot %s : %d ports rejetés (autre slot dans le buffer)",
                slot_id,
                skipped_wrong_slot,
            )

        if skipped_wrong_type > 0:
            logger.debug(
                "[LT_PORTS] Slot %s : %d lignes ignorées pour type non autorisé",
                slot_id,
                skipped_wrong_type,
            )

        return ports

    @staticmethod
    def _parse_all_ports_from_buffer(
        raw_buffer: str,
        known_slot_short_ids: List[str],
    ) -> Dict[str, List[Dict[str, Any]]]:
        ports_by_slot: Dict[str, List[Dict[str, Any]]] = {}
        for slot_short in known_slot_short_ids:
            ports_by_slot[slot_short] = []

        seen_full_ids: set = set()
        unmatched_count = 0
        skipped_type_count = 0
        total_parsed_lines = 0

        for line_orig in raw_buffer.splitlines():
            clean_line = line_orig.replace("\r", "")
            clean_line = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", clean_line)
            stripped = clean_line.strip()
            if not stripped:
                continue

            m = re.match(r"^(\S+):(\S+)\s+(\S+)(?:\s+(\S+))?", stripped)
            if not m:
                continue

            port_type = m.group(1)
            port_id = m.group(2)
            admin_state = m.group(3)
            oper_state = m.group(4) if m.group(4) else admin_state

            total_parsed_lines += 1

            if port_type not in ALLOWED_PORT_TYPES:
                skipped_type_count += 1
                continue

            full_id = f"{port_type}:{port_id}"
            if full_id in seen_full_ids:
                continue
            seen_full_ids.add(full_id)

            owner_slot = ISAMLTSlotsService._extract_slot_from_port_id(
                port_id,
                known_slot_short_ids,
            )

            if owner_slot is None:
                unmatched_count += 1
                continue

            slot_id = f"lt:{owner_slot}"

            port_dict: Dict[str, Any] = {
                "port_id": port_id,
                "slot_id": slot_id,
                "port_type": port_type,
                "admin_state": admin_state,
                "link_state": oper_state,
                "port_state": oper_state,
                "cfg_mtu": 0,
                "oper_mtu": 0,
                "lag_bndl": "-",
                "mode": "-",
                "encap": "-",
                "board": "LT",
                "raw_line": stripped,
                "slot_short_id": owner_slot,
            }

            ports_by_slot[owner_slot].append(port_dict)

        total_ports = sum(len(v) for v in ports_by_slot.values())
        logger.info(
            "[LT_GLOBAL_PARSE] Parsing global terminé : %d lignes parsées, "
            "%d ports retenus sur %d slots (%d non-matchés, %d types ignorés)",
            total_parsed_lines,
            total_ports,
            len(known_slot_short_ids),
            unmatched_count,
            skipped_type_count,
        )

        for slot_short in known_slot_short_ids:
            count = len(ports_by_slot[slot_short])
            if count > 0:
                types_in_slot = sorted({p["port_type"] for p in ports_by_slot[slot_short]})
                logger.info(
                    "[LT_GLOBAL_PARSE]   Slot %s → %d ports (types: %s)",
                    slot_short,
                    count,
                    ", ".join(types_in_slot),
                )
            else:
                logger.info("[LT_GLOBAL_PARSE]   Slot %s → 0 ports", slot_short)

        return ports_by_slot

    def _open_best_persistent_session(
        self,
        timeout: int,
    ) -> Tuple[bool, Optional[Protocol], Any, str]:
        """
        Ordre:
          1) SSH persistant
          2) SSH legacy persistant
          3) Telnet persistant
        """
        if self.instance.protocol_preference == "telnet":
            logger.info(
                "[LT_SESSION] Préférence TELNET pour %s, ouverture directe session Telnet persistante.",
                self.instance.host,
            )
            telnet_session = ISAMPersistentTelnet(self.instance, timeout=timeout)
            ok_tel, msg_tel = telnet_session.connect()
            if ok_tel:
                return True, "telnet", telnet_session, msg_tel
            return False, None, None, msg_tel

        logger.info(
            "[LT_SESSION] Tentative ouverture session persistante SSH pour %s.",
            self.instance.host,
        )
        ssh_session = _PersistentSSHSession(self.conn_service, timeout=timeout)
        ok_ssh, msg_ssh = ssh_session.connect()
        if ok_ssh:
            return True, "ssh", ssh_session, msg_ssh

        logger.warning(
            "[LT_SESSION] SSH persistante indisponible pour %s : %s. Tentative SSH legacy persistante...",
            self.instance.host,
            msg_ssh,
        )

        ssh_legacy_session = _PersistentSSHLegacySession(self.instance, timeout=timeout)
        ok_legacy, msg_legacy = ssh_legacy_session.connect()
        if ok_legacy:
            return True, "ssh-legacy", ssh_legacy_session, msg_legacy

        if self.instance.protocol_preference == "ssh":
            return False, None, None, f"SSH: {msg_ssh} ; SSH-LEGACY: {msg_legacy}"

        logger.warning(
            "[LT_SESSION] SSH legacy persistante indisponible pour %s : %s. Fallback Telnet...",
            self.instance.host,
            msg_legacy,
        )

        telnet_session = ISAMPersistentTelnet(self.instance, timeout=timeout)
        ok_tel, msg_tel = telnet_session.connect()
        if ok_tel:
            return True, "telnet", telnet_session, msg_tel

        return False, None, None, f"SSH: {msg_ssh} ; SSH-LEGACY: {msg_legacy} ; TELNET: {msg_tel}"

    def refresh_all_single_session(
        self,
        timeout: int = 40,
        idle_timeout: float = 3.0,
        post_send_delay: float = 1.0,
        inter_command_delay: float = 1.5,
    ) -> Tuple[
        bool,
        str,
        List[Dict[str, Any]],
        str,
    ]:
        """
        Récupère les slots LT ET les ports dans UNE SEULE session persistante.
        Ordre de tentative:
          SSH -> SSH legacy -> Telnet
        """
        logger.info(
            "[LT_SINGLE] Refresh complet single-session pour instance #%s (%s)",
            self.instance.id,
            self.instance.name,
        )

        ok_open, protocol_used, session, connect_msg = self._open_best_persistent_session(
            timeout=timeout
        )

        if not ok_open or session is None:
            logger.error("[LT_SINGLE] Impossible d'ouvrir la session : %s", connect_msg)
            return False, "", [], connect_msg

        logger.info(
            "[LT_SINGLE] Session persistante ouverte via protocole %s pour instance #%s.",
            protocol_used,
            self.instance.id,
        )

        try:
            cmd_slots = "show equipment slot | match exact:lt:"
            logger.info("[LT_SINGLE] Envoi commande slots : %r", cmd_slots)

            ok_s, raw_slots, err_s = session.execute(
                cmd_slots,
                idle_timeout=max(idle_timeout, 4.0),
                post_send_delay=max(post_send_delay, 1.2),
            )

            if not ok_s:
                msg = f"Erreur commande slots : {err_s}"
                logger.error("[LT_SINGLE] %s", msg)
                return False, "", [], msg

            logger.info(
                "[LT_SINGLE] Sortie slots (%d octets):\n%s",
                len(raw_slots),
                raw_slots[:2000],
            )

            slots = self._parse_lt_slots(raw_slots)
            logger.info("[LT_SINGLE] %d slots LT parsés.", len(slots))

            if not slots:
                return False, raw_slots, [], "Aucun slot LT parsé"

            known_slot_short_ids = [
                s["slot_short_id"] for s in slots
                if s.get("slot_short_id")
            ]

            logger.info(
                "[LT_SINGLE] %d slots candidats pour le mapping des ports : %s",
                len(known_slot_short_ids),
                ", ".join(known_slot_short_ids),
            )

            if not known_slot_short_ids:
                logger.info("[LT_SINGLE] Aucun slot trouvé, pas de ports à récupérer")
                for s in slots:
                    s["ports"] = []
                return True, raw_slots, slots, "OK"

            time.sleep(inter_command_delay)

            cmd_all_ports = "show interface port"
            logger.info("[LT_SINGLE] Envoi commande globale ports : %r", cmd_all_ports)

            ok_p, raw_all_ports, err_p = session.execute(
                cmd_all_ports,
                idle_timeout=20.0,
                post_send_delay=2.5,
            )

            if not ok_p:
                msg = f"Erreur commande ports globale : {err_p}"
                logger.error("[LT_SINGLE] %s", msg)
                for s in slots:
                    s["ports"] = []
                return True, raw_slots, slots, f"Slots OK mais ports KO : {err_p}"

            logger.info(
                "[LT_SINGLE] Sortie ports globale (%d octets, %d lignes):\n%s",
                len(raw_all_ports),
                len(raw_all_ports.splitlines()),
                raw_all_ports[:4000],
            )

            ports_by_slot_short = self._parse_all_ports_from_buffer(
                raw_all_ports,
                known_slot_short_ids,
            )

            for slot in slots:
                slot_short_id = slot.get("slot_short_id", "")
                slot["ports"] = ports_by_slot_short.get(slot_short_id, [])

                logger.info(
                    "[LT_SINGLE] Slot %s → %d ports (types: %s)",
                    slot["slot_id"],
                    len(slot["ports"]),
                    ", ".join(sorted({p["port_type"] for p in slot["ports"]})) or "(aucun)",
                )

            total_ports = sum(len(s.get("ports", [])) for s in slots)
            logger.info(
                "[LT_SINGLE] Refresh terminé : %d slots, %d ports au total (proto=%s)",
                len(slots),
                total_ports,
                protocol_used,
            )

            return True, raw_slots, slots, "OK"

        finally:
            try:
                session.close()
            except Exception:
                pass