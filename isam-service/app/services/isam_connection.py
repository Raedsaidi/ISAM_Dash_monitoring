import logging
import socket
import time
import subprocess
from typing import Tuple, Literal, Optional

import paramiko
import telnetlib

from app.models.isam_instance import ISAMInstance

logger = logging.getLogger(__name__)

Protocol = Literal["ssh", "ssh-legacy", "telnet"]


class ISAMConnectionService:
    """
    Service pour tester une connexion et exécuter une commande
    sur un ISAM donné (infos venant de ISAMInstance).
    """

    def __init__(self, instance: ISAMInstance):
        self.instance = instance

    # ----------- TESTS DE CONNEXION -----------

    def test_ssh_connection(self, timeout: int = 10) -> Tuple[bool, str]:
        """Test SSH standard (avec algorithmes modernes)"""
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        started_at = time.perf_counter()

        try:
            logger.info(
                "[SSH] Test connexion démarré vers %s:%s (timeout=%ss).",
                self.instance.host,
                self.instance.ssh_port,
                timeout,
            )

            client.connect(
                hostname=self.instance.host,
                port=self.instance.ssh_port,
                username=self.instance.username,
                password=self.instance.password,
                look_for_keys=False,
                allow_agent=False,
                timeout=timeout,
            )

            elapsed = round(time.perf_counter() - started_at, 2)
            msg = "[SSH] Connexion réussie."
            logger.info(
                "[SSH] Test connexion réussi vers %s:%s en %ss.",
                self.instance.host,
                self.instance.ssh_port,
                elapsed,
            )
            return True, msg

        except (socket.timeout, paramiko.ssh_exception.NoValidConnectionsError) as e:
            elapsed = round(time.perf_counter() - started_at, 2)
            msg = f"[SSH] Impossible de se connecter : {e}"
            logger.error(
                "[SSH] Test connexion échoué vers %s:%s après %ss : %s",
                self.instance.host,
                self.instance.ssh_port,
                elapsed,
                e,
            )
            return False, msg

        except paramiko.AuthenticationException:
            elapsed = round(time.perf_counter() - started_at, 2)
            msg = "[SSH] Erreur d'authentification."
            logger.error(
                "[SSH] Authentification échouée vers %s:%s après %ss.",
                self.instance.host,
                self.instance.ssh_port,
                elapsed,
            )
            return False, msg

        except Exception as e:
            elapsed = round(time.perf_counter() - started_at, 2)
            msg = f"[SSH] Erreur inattendue : {e}"
            logger.exception(
                "[SSH] Erreur inattendue vers %s:%s après %ss : %s",
                self.instance.host,
                self.instance.ssh_port,
                elapsed,
                e,
            )
            return False, msg

        finally:
            client.close()

    def test_ssh_connection_legacy(self, timeout: int = 10) -> Tuple[bool, str]:
        """Test SSH avec algorithmes legacy (ssh-rsa)"""
        started_at = time.perf_counter()

        try:
            logger.info(
                "[SSH-LEGACY] Test connexion démarré vers %s:%s (timeout=%ss).",
                self.instance.host,
                self.instance.ssh_port,
                timeout,
            )

            cmd = [
                "ssh",
                "-o", "HostKeyAlgorithms=+ssh-rsa",
                "-o", "PubkeyAcceptedAlgorithms=+ssh-rsa",
                "-o", "StrictHostKeyChecking=no",
                "-o", f"ConnectTimeout={timeout}",
                f"{self.instance.username}@{self.instance.host}",
                "-p", str(self.instance.ssh_port),
                "echo 'SSH Legacy connection successful'"
            ]

            result = subprocess.run(
                cmd,
                input=f"{self.instance.password}\n".encode(),
                capture_output=True,
                timeout=timeout + 5,
            )

            elapsed = round(time.perf_counter() - started_at, 2)
            if result.returncode == 0:
                msg = "[SSH-LEGACY] Connexion réussie avec algorithmes legacy."
                logger.info(
                    "[SSH-LEGACY] Test connexion réussi vers %s:%s en %ss.",
                    self.instance.host,
                    self.instance.ssh_port,
                    elapsed,
                )
                return True, msg
            else:
                stderr = result.stderr.decode("utf-8", errors="ignore")
                msg = f"[SSH-LEGACY] Connexion échouée: {stderr}"
                logger.warning(
                    "[SSH-LEGACY] Test connexion échoué vers %s:%s après %ss : %s",
                    self.instance.host,
                    self.instance.ssh_port,
                    elapsed,
                    stderr,
                )
                return False, msg

        except subprocess.TimeoutExpired:
            elapsed = round(time.perf_counter() - started_at, 2)
            msg = "[SSH-LEGACY] Timeout lors de la connexion."
            logger.error(
                "[SSH-LEGACY] Timeout connexion vers %s:%s après %ss.",
                self.instance.host,
                self.instance.ssh_port,
                elapsed,
            )
            return False, msg

        except Exception as e:
            elapsed = round(time.perf_counter() - started_at, 2)
            msg = f"[SSH-LEGACY] Erreur inattendue : {e}"
            logger.exception(
                "[SSH-LEGACY] Erreur inattendue vers %s:%s après %ss : %s",
                self.instance.host,
                self.instance.ssh_port,
                elapsed,
                e,
            )
            return False, msg

    def test_telnet_connection(self, timeout: int = 10) -> Tuple[bool, str]:
        started_at = time.perf_counter()

        try:
            logger.info(
                "[TELNET] Test connexion démarré vers %s:%s (timeout=%ss).",
                self.instance.host,
                self.instance.telnet_port,
                timeout,
            )

            with telnetlib.Telnet(
                self.instance.host,
                self.instance.telnet_port,
                timeout=timeout,
            ) as tn:
                tn.read_until(b"login: ", timeout=timeout)
                tn.write(self.instance.username.encode("ascii") + b"\n")

                tn.read_until(b"Password: ", timeout=timeout)
                tn.write(self.instance.password.encode("ascii") + b"\n")

                time.sleep(1)
                output = tn.read_very_eager().decode("ascii", errors="ignore")

                elapsed = round(time.perf_counter() - started_at, 2)

                if "#" in output or ">" in output:
                    msg = "[TELNET] Connexion réussie, prompt détecté."
                    logger.info(
                        "[TELNET] Test connexion réussi vers %s:%s en %ss.",
                        self.instance.host,
                        self.instance.telnet_port,
                        elapsed,
                    )
                    return True, msg
                else:
                    msg = "[TELNET] Connexion établie mais prompt non reconnu."
                    logger.warning(
                        "[TELNET] Connexion partielle vers %s:%s en %ss. Prompt non reconnu. Output=%r",
                        self.instance.host,
                        self.instance.telnet_port,
                        elapsed,
                        output,
                    )
                    return False, msg

        except (socket.timeout, ConnectionRefusedError) as e:
            elapsed = round(time.perf_counter() - started_at, 2)
            msg = f"[TELNET] Impossible de se connecter (timeout/refus) : {e}"
            logger.error(
                "[TELNET] Test connexion échoué vers %s:%s après %ss : %s",
                self.instance.host,
                self.instance.telnet_port,
                elapsed,
                e,
            )
            return False, msg

        except Exception as e:
            elapsed = round(time.perf_counter() - started_at, 2)
            msg = f"[TELNET] Erreur inattendue : {e}"
            logger.exception(
                "[TELNET] Erreur inattendue vers %s:%s après %ss : %s",
                self.instance.host,
                self.instance.telnet_port,
                elapsed,
                e,
            )
            return False, msg

    # ----------- EXÉCUTION DE COMMANDES -----------

    def execute_ssh_command(
        self,
        command: str,
        timeout: int = 20,
    ) -> Tuple[bool, str, str]:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        started_at = time.perf_counter()

        try:
            logger.info(
                "[SSH] Exécution commande démarrée vers %s:%s (timeout=%ss): %r",
                self.instance.host,
                self.instance.ssh_port,
                timeout,
                command,
            )

            client.connect(
                hostname=self.instance.host,
                port=self.instance.ssh_port,
                username=self.instance.username,
                password=self.instance.password,
                look_for_keys=False,
                allow_agent=False,
                timeout=timeout,
            )

            stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
            out = stdout.read().decode("utf-8", errors="ignore")
            err = stderr.read().decode("utf-8", errors="ignore")
            exit_status = stdout.channel.recv_exit_status()

            elapsed = round(time.perf_counter() - started_at, 2)

            if exit_status == 0:
                logger.info(
                    "[SSH] Commande exécutée avec succès vers %s:%s en %ss (stdout=%d chars, stderr=%d chars).",
                    self.instance.host,
                    self.instance.ssh_port,
                    elapsed,
                    len(out),
                    len(err),
                )
                return True, out, err
            else:
                msg = f"Commande SSH retournée avec code {exit_status}"
                logger.warning(
                    "[SSH] Commande échouée vers %s:%s en %ss (exit_status=%s).",
                    self.instance.host,
                    self.instance.ssh_port,
                    elapsed,
                    exit_status,
                )
                return False, out, err or msg

        except Exception as e:
            elapsed = round(time.perf_counter() - started_at, 2)
            msg = f"[SSH] Erreur lors de l'exécution de la commande : {e}"
            logger.exception(
                "[SSH] Erreur exécution commande vers %s:%s après %ss : %s",
                self.instance.host,
                self.instance.ssh_port,
                elapsed,
                e,
            )
            return False, "", msg

        finally:
            client.close()

    def execute_ssh_command_legacy(
        self,
        command: str,
        timeout: int = 20,
    ) -> Tuple[bool, str, str]:
        """Exécute une commande SSH avec algorithmes legacy"""
        started_at = time.perf_counter()

        try:
            logger.info(
                "[SSH-LEGACY] Exécution commande démarrée vers %s:%s (timeout=%ss): %r",
                self.instance.host,
                self.instance.ssh_port,
                timeout,
                command,
            )

            cmd = [
                "ssh",
                "-o", "HostKeyAlgorithms=+ssh-rsa",
                "-o", "PubkeyAcceptedAlgorithms=+ssh-rsa",
                "-o", "StrictHostKeyChecking=no",
                "-o", f"ConnectTimeout={timeout}",
                f"{self.instance.username}@{self.instance.host}",
                "-p", str(self.instance.ssh_port),
                command,
            ]

            result = subprocess.run(
                cmd,
                input=f"{self.instance.password}\n".encode(),
                capture_output=True,
                timeout=timeout + 5,
            )

            out = result.stdout.decode("utf-8", errors="ignore")
            err = result.stderr.decode("utf-8", errors="ignore")
            elapsed = round(time.perf_counter() - started_at, 2)

            if result.returncode == 0:
                logger.info(
                    "[SSH-LEGACY] Commande exécutée avec succès vers %s:%s en %ss (stdout=%d chars, stderr=%d chars).",
                    self.instance.host,
                    self.instance.ssh_port,
                    elapsed,
                    len(out),
                    len(err),
                )
                return True, out, err
            else:
                logger.warning(
                    "[SSH-LEGACY] Commande échouée vers %s:%s en %ss (returncode=%s).",
                    self.instance.host,
                    self.instance.ssh_port,
                    elapsed,
                    result.returncode,
                )
                return False, out, err

        except subprocess.TimeoutExpired:
            elapsed = round(time.perf_counter() - started_at, 2)
            msg = "[SSH-LEGACY] Timeout lors de l'exécution de la commande."
            logger.error(
                "[SSH-LEGACY] Timeout commande vers %s:%s après %ss.",
                self.instance.host,
                self.instance.ssh_port,
                elapsed,
            )
            return False, "", msg

        except Exception as e:
            elapsed = round(time.perf_counter() - started_at, 2)
            msg = f"[SSH-LEGACY] Erreur lors de l'exécution de la commande : {e}"
            logger.exception(
                "[SSH-LEGACY] Erreur exécution commande vers %s:%s après %ss : %s",
                self.instance.host,
                self.instance.ssh_port,
                elapsed,
                e,
            )
            return False, "", msg

    def execute_telnet_command(
        self,
        command: str,
        timeout: int = 20,
        idle_timeout: float = 1.0,
    ) -> Tuple[bool, str, str]:
        """
        Exécute une commande via Telnet en lisant la sortie jusqu'à ce qu'il
        n'y ait plus de données pendant idle_timeout secondes, ou qu'on dépasse
        timeout au total.
        """
        started_at = time.perf_counter()

        try:
            logger.info(
                "[TELNET] Exécution commande démarrée vers %s:%s (timeout=%ss, idle_timeout=%ss): %r",
                self.instance.host,
                self.instance.telnet_port,
                timeout,
                idle_timeout,
                command,
            )

            with telnetlib.Telnet(
                self.instance.host,
                self.instance.telnet_port,
                timeout=timeout,
            ) as tn:
                tn.read_until(b"login: ", timeout=timeout)
                tn.write(self.instance.username.encode("ascii") + b"\n")

                tn.read_until(b"Password: ", timeout=timeout)
                tn.write(self.instance.password.encode("ascii") + b"\n")

                time.sleep(1)
                tn.read_very_eager()

                for line in command.split("\n"):
                    line = line.strip()
                    if not line:
                        continue
                    tn.write(line.encode("ascii") + b"\n")
                    time.sleep(0.2)

                end_time = time.time() + timeout
                last_data_time = time.time()
                buffer = b""

                while time.time() < end_time:
                    chunk = tn.read_very_eager()
                    if chunk:
                        buffer += chunk
                        last_data_time = time.time()
                    else:
                        if buffer and (time.time() - last_data_time) > idle_timeout:
                            break
                        time.sleep(0.2)

                output = buffer.decode("ascii", errors="ignore")
                elapsed = round(time.perf_counter() - started_at, 2)

                logger.info(
                    "[TELNET] Commande exécutée avec succès vers %s:%s en %ss (output=%d chars).",
                    self.instance.host,
                    self.instance.telnet_port,
                    elapsed,
                    len(output),
                )
                return True, output, ""

        except Exception as e:
            elapsed = round(time.perf_counter() - started_at, 2)
            msg = f"[TELNET] Erreur lors de l'exécution de la commande : {e}"
            logger.exception(
                "[TELNET] Erreur exécution commande vers %s:%s après %ss : %s",
                self.instance.host,
                self.instance.telnet_port,
                elapsed,
                e,
            )
            return False, "", msg

    # ----------- TESTS AVEC STRATÉGIES -----------

    def test_connection_preference(
        self,
        timeout: int = 10,
    ) -> Tuple[bool, Optional[Protocol], str]:
        started_at = time.perf_counter()

        if self.instance.protocol_preference == "telnet":
            ok, msg = self.test_telnet_connection(timeout=timeout)
            elapsed = round(time.perf_counter() - started_at, 2)
            logger.info(
                "[STRATEGY] Test connexion terminé pour %s via préférence TELNET en %ss -> ok=%s",
                self.instance.host,
                elapsed,
                ok,
            )
            return ok, "telnet" if ok else None, msg

        ssh_ok, ssh_msg = self.test_ssh_connection(timeout=timeout)
        if ssh_ok:
            elapsed = round(time.perf_counter() - started_at, 2)
            logger.info(
                "[STRATEGY] Test connexion terminé pour %s via SSH standard en %ss -> ok=True",
                self.instance.host,
                elapsed,
            )
            return True, "ssh", ssh_msg

        logger.info("[STRATEGY] SSH standard échoué, tentative SSH legacy...")

        ssh_legacy_ok, ssh_legacy_msg = self.test_ssh_connection_legacy(timeout=timeout)
        if ssh_legacy_ok:
            elapsed = round(time.perf_counter() - started_at, 2)
            logger.info(
                "[STRATEGY] Test connexion terminé pour %s via SSH legacy en %ss -> ok=True",
                self.instance.host,
                elapsed,
            )
            return True, "ssh-legacy", ssh_legacy_msg

        if self.instance.protocol_preference == "ssh":
            elapsed = round(time.perf_counter() - started_at, 2)
            logger.warning(
                "[STRATEGY] Test connexion terminé pour %s après %ss -> SSH et SSH legacy ont échoué.",
                self.instance.host,
                elapsed,
            )
            return False, None, f"SSH: {ssh_msg} ; SSH-LEGACY: {ssh_legacy_msg}"

        logger.info("[STRATEGY] SSH échoué, tentative Telnet...")

        telnet_ok, telnet_msg = self.test_telnet_connection(timeout=timeout)
        elapsed = round(time.perf_counter() - started_at, 2)

        if telnet_ok:
            logger.info(
                "[STRATEGY] Test connexion terminé pour %s via TELNET fallback en %ss -> ok=True",
                self.instance.host,
                elapsed,
            )
            return True, "telnet", telnet_msg

        logger.warning(
            "[STRATEGY] Test connexion terminé pour %s après %ss -> tous les protocoles ont échoué.",
            self.instance.host,
            elapsed,
        )
        return False, None, f"SSH: {ssh_msg} ; SSH-LEGACY: {ssh_legacy_msg} ; TELNET: {telnet_msg}"

    def execute_command_preference(
        self,
        command: str,
        timeout: int = 20,
    ) -> Tuple[bool, Optional[Protocol], str, str]:
        started_at = time.perf_counter()

        if self.instance.protocol_preference == "telnet":
            ok, out, err = self.execute_telnet_command(command, timeout=timeout)
            elapsed = round(time.perf_counter() - started_at, 2)
            logger.info(
                "[STRATEGY] Commande terminée pour %s via préférence TELNET en %ss -> ok=%s",
                self.instance.host,
                elapsed,
                ok,
            )
            return ok, "telnet" if ok else None, out, err

        ok, out, err = self.execute_ssh_command(command, timeout=timeout)
        if ok:
            elapsed = round(time.perf_counter() - started_at, 2)
            logger.info(
                "[STRATEGY] Commande terminée pour %s via SSH standard en %ss -> ok=True",
                self.instance.host,
                elapsed,
            )
            return True, "ssh", out, err

        logger.info("[STRATEGY] SSH standard échoué, tentative SSH legacy...")

        ok_legacy, out_legacy, err_legacy = self.execute_ssh_command_legacy(
            command,
            timeout=timeout,
        )
        if ok_legacy:
            elapsed = round(time.perf_counter() - started_at, 2)
            logger.info(
                "[STRATEGY] Commande terminée pour %s via SSH legacy en %ss -> ok=True",
                self.instance.host,
                elapsed,
            )
            return True, "ssh-legacy", out_legacy, err_legacy

        if self.instance.protocol_preference == "ssh":
            elapsed = round(time.perf_counter() - started_at, 2)
            logger.warning(
                "[STRATEGY] Commande terminée pour %s après %ss -> SSH et SSH legacy ont échoué.",
                self.instance.host,
                elapsed,
            )
            return False, None, out, f"SSH: {err} ; SSH-LEGACY: {err_legacy}"

        logger.info("[STRATEGY] SSH échoué, tentative Telnet...")

        ok_tel, out_tel, msg_tel = self.execute_telnet_command(
            command,
            timeout=timeout,
        )
        elapsed = round(time.perf_counter() - started_at, 2)

        if ok_tel:
            logger.info(
                "[STRATEGY] Commande terminée pour %s via TELNET fallback en %ss -> ok=True",
                self.instance.host,
                elapsed,
            )
            return True, "telnet", out_tel, msg_tel

        logger.warning(
            "[STRATEGY] Commande terminée pour %s après %ss -> tous les protocoles ont échoué.",
            self.instance.host,
            elapsed,
        )
        return False, None, "", f"SSH: {err} ; SSH-LEGACY: {err_legacy} ; TELNET: {msg_tel}"


# ─────────────────────────────────────────────────────────────────────
#  SESSION TELNET PERSISTANTE (multi-commandes sur une seule connexion)
# ─────────────────────────────────────────────────────────────────────


class ISAMPersistentTelnet:
    """
    Session Telnet persistante : UNE connexion, N commandes.
    """

    def __init__(self, instance: ISAMInstance, timeout: int = 30):
        self.instance = instance
        self.timeout = timeout
        self._tn: Optional[telnetlib.Telnet] = None
        self._connected = False

    @property
    def connected(self) -> bool:
        return self._connected

    def connect(self) -> Tuple[bool, str]:
        """Ouvre la connexion Telnet et effectue le login UNE SEULE FOIS."""
        started_at = time.perf_counter()

        try:
            logger.info(
                "[TELNET-PERSIST] Ouverture session démarrée vers %s:%s (timeout=%ss).",
                self.instance.host,
                self.instance.telnet_port,
                self.timeout,
            )

            self._tn = telnetlib.Telnet(
                self.instance.host,
                self.instance.telnet_port,
                timeout=self.timeout,
            )

            idx, _, _ = self._tn.expect(
                [b"login:", b"Login:", b"username:", b"Username:"],
                timeout=self.timeout,
            )
            if idx == -1:
                self._cleanup()
                elapsed = round(time.perf_counter() - started_at, 2)
                logger.error(
                    "[TELNET-PERSIST] Prompt login non détecté vers %s:%s après %ss.",
                    self.instance.host,
                    self.instance.telnet_port,
                    elapsed,
                )
                return False, "[TELNET-PERSIST] Prompt login non détecté."

            self._tn.write(self.instance.username.encode("ascii") + b"\n")

            idx2, _, _ = self._tn.expect(
                [b"Password:", b"password:"],
                timeout=self.timeout,
            )
            if idx2 == -1:
                self._cleanup()
                elapsed = round(time.perf_counter() - started_at, 2)
                logger.error(
                    "[TELNET-PERSIST] Prompt password non détecté vers %s:%s après %ss.",
                    self.instance.host,
                    self.instance.telnet_port,
                    elapsed,
                )
                return False, "[TELNET-PERSIST] Prompt password non détecté."

            self._tn.write(self.instance.password.encode("ascii") + b"\n")

            time.sleep(2.0)
            try:
                self._tn.read_very_eager()
            except Exception:
                pass

            self._connected = True
            elapsed = round(time.perf_counter() - started_at, 2)

            logger.info(
                "[TELNET-PERSIST] Session ouverte avec succès vers %s:%s en %ss.",
                self.instance.host,
                self.instance.telnet_port,
                elapsed,
            )
            return True, "[TELNET-PERSIST] Session ouverte avec succès."

        except Exception as e:
            self._cleanup()
            elapsed = round(time.perf_counter() - started_at, 2)
            msg = f"[TELNET-PERSIST] Échec connexion : {e}"
            logger.exception(
                "[TELNET-PERSIST] Echec ouverture session vers %s:%s après %ss : %s",
                self.instance.host,
                self.instance.telnet_port,
                elapsed,
                e,
            )
            return False, msg

    def close(self):
        self._cleanup()
        logger.info("[TELNET-PERSIST] Session fermée pour %s:%s.", self.instance.host, self.instance.telnet_port)

    def _cleanup(self):
        if self._tn:
            try:
                self._tn.close()
            except Exception:
                pass
            self._tn = None
        self._connected = False

    def execute(
        self,
        command: str,
        idle_timeout: float = 3.0,
        post_send_delay: float = 1.0,
    ) -> Tuple[bool, str, str]:
        """
        Exécute une commande sur la session déjà ouverte.
        """
        if not self._connected or not self._tn:
            return False, "", "[TELNET-PERSIST] Session non connectée."

        started_at = time.perf_counter()

        try:
            try:
                self._tn.read_very_eager()
            except Exception:
                pass

            logger.info(
                "[TELNET-PERSIST] Exécution commande démarrée vers %s:%s (idle_timeout=%ss, post_send_delay=%ss): %r",
                self.instance.host,
                self.instance.telnet_port,
                idle_timeout,
                post_send_delay,
                command,
            )

            for line in command.split("\n"):
                line = line.strip()
                if not line:
                    continue
                self._tn.write(line.encode("ascii") + b"\n")
                time.sleep(0.3)

            time.sleep(post_send_delay)

            end_time = time.time() + self.timeout
            last_data_time = time.time()
            buf = b""

            while time.time() < end_time:
                try:
                    chunk = self._tn.read_very_eager()
                except EOFError:
                    self._connected = False
                    logger.warning(
                        "[TELNET-PERSIST] Connexion fermée par le serveur pendant la commande %r.",
                        command,
                    )
                    break

                if chunk:
                    buf += chunk
                    last_data_time = time.time()
                else:
                    if buf and (time.time() - last_data_time) > idle_timeout:
                        break
                    time.sleep(0.2)

            output = buf.decode("ascii", errors="ignore")
            elapsed = round(time.perf_counter() - started_at, 2)

            logger.info(
                "[TELNET-PERSIST] Commande terminée vers %s:%s en %ss (output=%d chars).",
                self.instance.host,
                self.instance.telnet_port,
                elapsed,
                len(output),
            )
            return True, output, ""

        except Exception as e:
            self._connected = False
            elapsed = round(time.perf_counter() - started_at, 2)
            msg = f"[TELNET-PERSIST] Erreur exécution : {e}"
            logger.exception(
                "[TELNET-PERSIST] Erreur exécution commande vers %s:%s après %ss : %s",
                self.instance.host,
                self.instance.telnet_port,
                elapsed,
                e,
            )
            return False, "", msg

    def __enter__(self):
        ok, msg = self.connect()
        if not ok:
            raise ConnectionError(msg)
        return self

    def __exit__(self, *exc):
        self.close()


def test_connection_for_instance(instance: ISAMInstance, timeout: int = 10):
    """
    Helper pour les health-checks.
    Retourne (success, protocol_used, message, response_time_ms)
    """
    started_at = time.perf_counter()

    service = ISAMConnectionService(instance)
    ok, proto, msg = service.test_connection_preference(timeout=timeout)

    duration_ms = int((time.perf_counter() - started_at) * 1000)

    logger.info(
        "[HEALTH-CHECK] Instance #%s (%s) testée en %sms -> ok=%s, proto=%s",
        instance.id,
        instance.name,
        duration_ms,
        ok,
        proto,
    )

    return ok, proto, msg, duration_ms