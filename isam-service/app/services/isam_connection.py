import logging
import re
import shutil
import socket
import subprocess
import time
import select
from typing import Literal, Optional, Tuple, Pattern

import paramiko
import telnetlib

from app.models.isam_instance import ISAMInstance

logger = logging.getLogger(__name__)

Protocol = Literal["ssh", "ssh-legacy", "telnet"]

# ANSI escape sequences (ex: \x1b[1D) that appear in your outputs
_ANSI_RE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")


class ISAMConnectionService:
    """
    Service pour tester une connexion et exécuter une commande
    sur un ISAM donné (infos venant de ISAMInstance).

    Stratégie:
      1) SSH standard (Paramiko + shell interactif)
      2) SSH legacy (OpenSSH + sshpass + shell interactif)
      3) Telnet
    """

    def __init__(self, instance: ISAMInstance):
        self.instance = instance

    # =========================================================
    # OUTILS INTERNES
    # =========================================================

    def _build_ssh_client(self) -> paramiko.SSHClient:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        return client

    def _connect_ssh(
        self,
        timeout: int = 10,
        legacy_algorithms: bool = False,
    ) -> paramiko.SSHClient:
        """
        Ouvre une connexion SSH Paramiko.
        Si legacy_algorithms=True, on autorise des algorithmes plus anciens.
        """
        client = self._build_ssh_client()

        connect_kwargs = {
            "hostname": self.instance.host,
            "port": self.instance.ssh_port,
            "username": self.instance.username,
            "password": self.instance.password,
            "look_for_keys": False,
            "allow_agent": False,
            "timeout": timeout,
            "banner_timeout": timeout,
            "auth_timeout": timeout,
        }

        if legacy_algorithms:
            connect_kwargs["disabled_algorithms"] = {}

        client.connect(**connect_kwargs)
        return client

    def _open_ssh_shell(
        self,
        client: paramiko.SSHClient,
        timeout: int = 10,
        read_delay: float = 1.0,
    ) -> paramiko.Channel:
        """
        Ouvre un shell interactif SSH avec PTY explicite.
        Plus robuste sur des équipements réseau anciens.
        """
        transport = client.get_transport()
        if transport is None or not transport.is_active():
            raise paramiko.SSHException("SSH transport not active")

        chan = transport.open_session(timeout=timeout)
        chan.get_pty(term="vt100", width=200, height=100)
        chan.invoke_shell()
        chan.settimeout(timeout)

        time.sleep(read_delay)

        try:
            if chan.recv_ready():
                banner = chan.recv(65535).decode("utf-8", errors="ignore")
                logger.debug(
                    "[SSH] Bannière/prompt initial reçu depuis %s:%s : %r",
                    self.instance.host,
                    self.instance.ssh_port,
                    banner[-500:],
                )
        except Exception:
            logger.debug(
                "[SSH] Aucun flux initial lisible après ouverture du shell sur %s:%s.",
                self.instance.host,
                self.instance.ssh_port,
            )

        if chan.closed:
            raise paramiko.SSHException("SSH shell channel closed immediately by server")

        return chan

    def _make_prompt_re(self) -> Pattern[str]:
        """
        Prompt ISAM looks like:  leg:isadmin>#  or  leg:isadmin>configure>...#
        We'll match any line that contains the username and ends with > or #.
        """
        user = (self.instance.username or "").strip()
        if user:
            u = re.escape(user)
            return re.compile(rf"(?m)^[^\n]*\b{u}\b[^\n]*[>#]\s*$")
        # fallback: any line ending with prompt char
        return re.compile(r"(?m)^[^\n]*[>#]\s*$")

    def _drain_shell(self, chan: paramiko.Channel, max_seconds: float = 0.6) -> None:
        """
        Drain any remaining bytes in the channel buffer (prevents output shifting).
        """
        end = time.time() + max_seconds
        while time.time() < end:
            if chan.closed:
                return
            if chan.recv_ready():
                try:
                    _ = chan.recv(65535)
                except Exception:
                    return
                continue
            time.sleep(0.05)

    def _read_shell_output(
        self,
        chan: paramiko.Channel,
        timeout: int = 20,
        idle_timeout: float = 1.5,
    ) -> str:
        """
        Legacy reader: reads until idle_timeout silence OR global timeout.
        Kept for compatibility, but for persistent shells prefer _read_shell_output_until_prompt().
        """
        end_time = time.time() + timeout
        last_data_time = time.time()
        chunks: list[str] = []

        while time.time() < end_time:
            if chan.closed:
                break

            try:
                if chan.recv_ready():
                    data = chan.recv(65535)
                    if not data:
                        break
                    decoded = data.decode("utf-8", errors="ignore")
                    chunks.append(decoded)
                    last_data_time = time.time()
                else:
                    if chunks and (time.time() - last_data_time) > idle_timeout:
                        break
                    time.sleep(0.2)

            except socket.timeout:
                if chunks and (time.time() - last_data_time) > idle_timeout:
                    break

            except Exception as e:
                logger.debug(
                    "[SSH] Lecture shell interrompue sur %s:%s : %s",
                    self.instance.host,
                    self.instance.ssh_port,
                    e,
                )
                break

        return "".join(chunks)

    def _read_shell_output_until_prompt(
        self,
        chan: paramiko.Channel,
        *,
        timeout: int = 30,
        idle_no_prompt: float = 8.0,
        idle_after_prompt: float = 0.35,
        prompt_re: Optional[Pattern[str]] = None,
    ) -> str:
        """
        Robust reader for persistent interactive shells:
        reads until we see the prompt again (recommended).
        This prevents output shifting between commands.

        - idle_no_prompt: safety if prompt never comes
        - idle_after_prompt: small grace time after seeing prompt
        """
        if prompt_re is None:
            prompt_re = self._make_prompt_re()

        end = time.time() + timeout
        last_data = time.time()
        saw_prompt = False
        chunks: list[str] = []

        while time.time() < end:
            if chan.closed:
                break

            try:
                if chan.recv_ready():
                    data = chan.recv(65535)
                    if not data:
                        break
                    decoded = data.decode("utf-8", errors="ignore")
                    chunks.append(decoded)
                    last_data = time.time()

                    # check prompt on a recent window (faster)
                    window = "".join(chunks[-6:])
                    if prompt_re.search(window):
                        saw_prompt = True
                    continue

                # no data available
                idle = time.time() - last_data
                if saw_prompt and idle >= idle_after_prompt:
                    break
                if (not saw_prompt) and chunks and idle >= idle_no_prompt:
                    break

                time.sleep(0.08)

            except socket.timeout:
                idle = time.time() - last_data
                if saw_prompt and idle >= idle_after_prompt:
                    break
                if (not saw_prompt) and chunks and idle >= idle_no_prompt:
                    break
            except Exception as e:
                logger.debug(
                    "[SSH] Lecture shell (until prompt) interrompue sur %s:%s : %s",
                    self.instance.host,
                    self.instance.ssh_port,
                    e,
                )
                break

        return "".join(chunks)

    def _sanitize_command_output(self, output: str, command: str) -> str:
        """
        Nettoyage léger de la sortie brute + suppression ANSI.
        """
        if not output:
            return ""

        cleaned = output.replace("\r", "")
        cleaned = _ANSI_RE.sub("", cleaned)
        return cleaned.strip()

    def _sshpass_available(self) -> bool:
        return shutil.which("sshpass") is not None

    def _openssh_available(self) -> bool:
        return shutil.which("ssh") is not None

    # =========================================================
    # TESTS DE CONNEXION
    # =========================================================

    def test_ssh_connection(self, timeout: int = 10) -> Tuple[bool, str]:
        started_at = time.perf_counter()
        client: Optional[paramiko.SSHClient] = None
        chan: Optional[paramiko.Channel] = None

        try:
            logger.info(
                "[SSH] Test de connexion démarré vers %s:%s (timeout=%ss).",
                self.instance.host,
                self.instance.ssh_port,
                timeout,
            )

            client = self._connect_ssh(timeout=timeout, legacy_algorithms=False)
            chan = self._open_ssh_shell(client, timeout=timeout, read_delay=1.0)

            elapsed = round(time.perf_counter() - started_at, 2)
            msg = "[SSH] Connexion et ouverture du shell réussies."
            logger.info(
                "[SSH] Test de connexion réussi vers %s:%s en %ss.",
                self.instance.host,
                self.instance.ssh_port,
                elapsed,
            )
            return True, msg

        except paramiko.AuthenticationException:
            elapsed = round(time.perf_counter() - started_at, 2)
            msg = "[SSH] Authentification échouée."
            logger.warning(
                "[SSH] Authentification refusée sur %s:%s après %ss.",
                self.instance.host,
                self.instance.ssh_port,
                elapsed,
            )
            return False, msg

        except (socket.timeout, TimeoutError):
            elapsed = round(time.perf_counter() - started_at, 2)
            msg = "[SSH] Timeout lors de la connexion ou de l’ouverture du shell."
            logger.error(
                "[SSH] Timeout sur %s:%s après %ss.",
                self.instance.host,
                self.instance.ssh_port,
                elapsed,
            )
            return False, msg

        except paramiko.ssh_exception.NoValidConnectionsError as e:
            elapsed = round(time.perf_counter() - started_at, 2)
            msg = f"[SSH] Connexion impossible : {e}"
            logger.error(
                "[SSH] Connexion impossible vers %s:%s après %ss : %s",
                self.instance.host,
                self.instance.ssh_port,
                elapsed,
                e,
            )
            return False, msg

        except paramiko.SSHException as e:
            elapsed = round(time.perf_counter() - started_at, 2)
            msg = f"[SSH] Le serveur a refusé ou fermé le shell SSH : {e}"
            logger.error(
                "[SSH] Ouverture de shell refusée/fermée sur %s:%s après %ss : %s",
                self.instance.host,
                self.instance.ssh_port,
                elapsed,
                e,
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
            try:
                if chan and not chan.closed:
                    chan.close()
            except Exception:
                pass
            if client:
                client.close()

    def test_ssh_connection_legacy(self, timeout: int = 10) -> Tuple[bool, str]:
        started_at = time.perf_counter()

        if not self._openssh_available():
            msg = "[SSH-LEGACY] Le binaire 'ssh' est introuvable."
            logger.error(msg)
            return False, msg

        if not self._sshpass_available():
            msg = "[SSH-LEGACY] Le binaire 'sshpass' est introuvable."
            logger.error(msg)
            return False, msg

        proc: Optional[subprocess.Popen] = None

        try:
            logger.info(
                "[SSH-LEGACY] Test de connexion démarré vers %s:%s (timeout=%ss).",
                self.instance.host,
                self.instance.ssh_port,
                timeout,
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
                f"ConnectTimeout={timeout}",
                "-p",
                str(self.instance.ssh_port),
                f"{self.instance.username}@{self.instance.host}",
            ]

            proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )

            if proc.stdin is None or proc.stdout is None or proc.stderr is None:
                raise RuntimeError("Impossible d'ouvrir le process SSH legacy")

            time.sleep(2.0)

            proc.stdin.write("echo SSH_LEGACY_OK\n")
            proc.stdin.flush()

            end_time = time.time() + timeout
            collected_out = ""
            collected_err = ""

            while time.time() < end_time:
                ready, _, _ = select.select([proc.stdout, proc.stderr], [], [], 0.5)
                for stream in ready:
                    chunk = stream.read()
                    if not chunk:
                        continue
                    if stream is proc.stdout:
                        collected_out += chunk
                    else:
                        collected_err += chunk

                if "SSH_LEGACY_OK" in collected_out:
                    elapsed = round(time.perf_counter() - started_at, 2)
                    logger.info(
                        "[SSH-LEGACY] Test de connexion réussi vers %s:%s en %ss.",
                        self.instance.host,
                        self.instance.ssh_port,
                        elapsed,
                    )
                    try:
                        proc.stdin.write("exit\n")
                        proc.stdin.flush()
                    except Exception:
                        pass
                    proc.terminate()
                    return True, "[SSH-LEGACY] Connexion legacy réussie."

                if proc.poll() is not None:
                    break

            elapsed = round(time.perf_counter() - started_at, 2)
            msg = "[SSH-LEGACY] Échec de connexion interactive legacy."
            logger.warning(
                "[SSH-LEGACY] Test échoué vers %s:%s après %ss. stdout=%r stderr=%r",
                self.instance.host,
                self.instance.ssh_port,
                elapsed,
                collected_out[-500:],
                collected_err[-500:],
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

        finally:
            if proc:
                try:
                    proc.terminate()
                except Exception:
                    pass

    def test_telnet_connection(self, timeout: int = 10) -> Tuple[bool, str]:
        started_at = time.perf_counter()

        try:
            logger.info(
                "[TELNET] Test de connexion démarré vers %s:%s (timeout=%ss).",
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
                        "[TELNET] Test de connexion réussi vers %s:%s en %ss.",
                        self.instance.host,
                        self.instance.telnet_port,
                        elapsed,
                    )
                    return True, msg

                msg = "[TELNET] Connexion établie mais prompt non reconnu."
                logger.warning(
                    "[TELNET] Connexion partielle vers %s:%s en %ss. Output=%r",
                    self.instance.host,
                    self.instance.telnet_port,
                    elapsed,
                    output[-500:],
                )
                return False, msg

        except (socket.timeout, ConnectionRefusedError) as e:
            elapsed = round(time.perf_counter() - started_at, 2)
            msg = f"[TELNET] Connexion impossible : {e}"
            logger.error(
                "[TELNET] Échec de connexion vers %s:%s après %ss : %s",
                self.instance.host,
                self.instance.telnet_port,
                elapsed,
                e,
            )
            return False, msg

        except EOFError as e:
            elapsed = round(time.perf_counter() - started_at, 2)
            msg = f"[TELNET] La connexion a été fermée par le serveur : {e}"
            logger.error(
                "[TELNET] Fermeture distante sur %s:%s après %ss : %s",
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

    # =========================================================
    # EXÉCUTION DE COMMANDES
    # =========================================================

    def execute_ssh_command(
        self,
        command: str,
        timeout: int = 20,
        idle_timeout: float = 1.5,
        post_send_delay: float = 1.0,
        init_command: Optional[str] = None,
    ) -> Tuple[bool, str, str]:
        """
        Exécute une commande via SSH avec shell interactif (Paramiko).

        FIX IMPORTANT:
        on lit jusqu'au prompt (au lieu de "silence idle_timeout"), sinon tu auras
        des sorties décalées entre commandes (ce que tu as vu pour 1/1/8, 1/1/10...).
        """
        started_at = time.perf_counter()
        client: Optional[paramiko.SSHClient] = None
        chan: Optional[paramiko.Channel] = None
        prompt_re = self._make_prompt_re()

        try:
            logger.info(
                "[SSH] Exécution commande démarrée vers %s:%s (timeout=%ss, idle_timeout=%ss): %r",
                self.instance.host,
                self.instance.ssh_port,
                timeout,
                idle_timeout,
                command,
            )

            client = self._connect_ssh(timeout=timeout, legacy_algorithms=False)
            chan = self._open_ssh_shell(client, timeout=timeout, read_delay=1.2)

            # Drain any banner/prompt
            try:
                self._drain_shell(chan, max_seconds=0.5)
                _ = self._read_shell_output_until_prompt(
                    chan,
                    timeout=4,
                    idle_no_prompt=max(2.0, idle_timeout),
                    prompt_re=prompt_re,
                )
            except Exception:
                pass

            if chan.closed:
                raise paramiko.SSHException("SSH shell channel closed before sending command")

            if init_command:
                chan.send(init_command + "\n")
                time.sleep(0.3)
                _ = self._read_shell_output_until_prompt(
                    chan,
                    timeout=min(8, timeout),
                    idle_no_prompt=max(3.0, idle_timeout),
                    prompt_re=prompt_re,
                )

            # IMPORTANT: send line by line + read until prompt EACH line
            out_parts: list[str] = []
            for line in command.split("\n"):
                line = line.strip()
                if not line:
                    continue

                if chan.closed:
                    raise paramiko.SSHException("SSH shell channel closed during command send")

                chan.send(line + "\n")
                time.sleep(0.10)

                raw = self._read_shell_output_until_prompt(
                    chan,
                    timeout=timeout,
                    idle_no_prompt=max(8.0, idle_timeout),
                    prompt_re=prompt_re,
                )
                out_parts.append(raw)

            time.sleep(post_send_delay)

            output = "".join(out_parts)
            cleaned_output = self._sanitize_command_output(output, command)
            elapsed = round(time.perf_counter() - started_at, 2)

            logger.info(
                "[SSH] Commande terminée vers %s:%s en %ss (output=%d chars).",
                self.instance.host,
                self.instance.ssh_port,
                elapsed,
                len(cleaned_output or ""),
            )
            return True, cleaned_output, ""

        except paramiko.AuthenticationException:
            elapsed = round(time.perf_counter() - started_at, 2)
            msg = "[SSH] Authentification échouée lors de l'exécution."
            logger.warning(
                "[SSH] Authentification refusée pendant exécution vers %s:%s après %ss.",
                self.instance.host,
                self.instance.ssh_port,
                elapsed,
            )
            return False, "", msg

        except paramiko.SSHException as e:
            elapsed = round(time.perf_counter() - started_at, 2)
            msg = f"[SSH] Le serveur SSH a refusé ou fermé le shell/canal : {e}"
            logger.error(
                "[SSH] Shell/canal fermé par le serveur sur %s:%s après %ss : %s",
                self.instance.host,
                self.instance.ssh_port,
                elapsed,
                e,
            )
            return False, "", msg

        except socket.timeout:
            elapsed = round(time.perf_counter() - started_at, 2)
            msg = "[SSH] Timeout lors de l’exécution de la commande."
            logger.error(
                "[SSH] Timeout commande vers %s:%s après %ss.",
                self.instance.host,
                self.instance.ssh_port,
                elapsed,
            )
            return False, "", msg

        except Exception as e:
            elapsed = round(time.perf_counter() - started_at, 2)
            msg = f"[SSH] Erreur inattendue lors de l'exécution : {e}"
            logger.exception(
                "[SSH] Erreur exécution commande vers %s:%s après %ss : %s",
                self.instance.host,
                self.instance.ssh_port,
                elapsed,
                e,
            )
            return False, "", msg

        finally:
            try:
                if chan and not chan.closed:
                    chan.close()
            except Exception:
                pass
            if client:
                client.close()

    # (ssh legacy + telnet unchanged below)
    # =========================================================

    def execute_ssh_command_legacy(
        self,
        command: str,
        timeout: int = 20,
        idle_timeout: float = 1.5,
        post_send_delay: float = 1.0,
    ) -> Tuple[bool, str, str]:
        started_at = time.perf_counter()

        if not self._openssh_available():
            msg = "[SSH-LEGACY] Le binaire 'ssh' est introuvable."
            logger.error(msg)
            return False, "", msg

        if not self._sshpass_available():
            msg = "[SSH-LEGACY] Le binaire 'sshpass' est introuvable."
            logger.error(msg)
            return False, "", msg

        proc: Optional[subprocess.Popen] = None

        try:
            logger.info(
                "[SSH-LEGACY] Exécution commande démarrée vers %s:%s (timeout=%ss): %r",
                self.instance.host,
                self.instance.ssh_port,
                timeout,
                command,
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
                f"ConnectTimeout={timeout}",
                "-p",
                str(self.instance.ssh_port),
                f"{self.instance.username}@{self.instance.host}",
            ]

            proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )

            if proc.stdin is None or proc.stdout is None or proc.stderr is None:
                raise RuntimeError("Impossible d'ouvrir le process SSH legacy")

            time.sleep(2.0)

            try:
                ready, _, _ = select.select([proc.stdout, proc.stderr], [], [], 0.5)
                for stream in ready:
                    _ = stream.read()
            except Exception:
                pass

            for line in command.split("\n"):
                line = line.strip()
                if not line:
                    continue
                proc.stdin.write(line + "\n")
                proc.stdin.flush()
                time.sleep(0.35)

            time.sleep(post_send_delay)

            end_time = time.time() + timeout
            last_data_time = time.time()
            collected_out = ""
            collected_err = ""

            while time.time() < end_time:
                if proc.poll() is not None:
                    try:
                        out_rest, err_rest = proc.communicate(timeout=1)
                    except Exception:
                        out_rest, err_rest = "", ""
                    collected_out += out_rest or ""
                    collected_err += err_rest or ""
                    break

                ready, _, _ = select.select([proc.stdout, proc.stderr], [], [], 0.2)

                got_data = False
                for stream in ready:
                    chunk = stream.read()
                    if not chunk:
                        continue
                    got_data = True
                    if stream is proc.stdout:
                        collected_out += chunk
                    else:
                        collected_err += chunk

                if got_data:
                    last_data_time = time.time()
                else:
                    if (collected_out or collected_err) and (time.time() - last_data_time) > idle_timeout:
                        break

            try:
                proc.stdin.write("exit\n")
                proc.stdin.flush()
            except Exception:
                pass

            cleaned_out = self._sanitize_command_output(collected_out, command)
            cleaned_err = self._sanitize_command_output(collected_err, command)
            elapsed = round(time.perf_counter() - started_at, 2)

            if cleaned_out:
                logger.info(
                    "[SSH-LEGACY] Commande exécutée avec succès vers %s:%s en %ss (stdout=%d chars, stderr=%d chars).",
                    self.instance.host,
                    self.instance.ssh_port,
                    elapsed,
                    len(cleaned_out),
                    len(cleaned_err),
                )
                return True, cleaned_out, cleaned_err

            msg = cleaned_err or "[SSH-LEGACY] Aucune sortie reçue après exécution."
            logger.warning(
                "[SSH-LEGACY] Commande sans sortie utile vers %s:%s en %ss (stderr=%r).",
                self.instance.host,
                self.instance.ssh_port,
                elapsed,
                cleaned_err[-500:],
            )
            return False, cleaned_out, msg

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
            msg = f"[SSH-LEGACY] Erreur inattendue lors de l'exécution : {e}"
            logger.exception(
                "[SSH-LEGACY] Erreur exécution commande vers %s:%s après %ss : %s",
                self.instance.host,
                self.instance.ssh_port,
                elapsed,
                e,
            )
            return False, "", msg

        finally:
            if proc:
                try:
                    proc.terminate()
                except Exception:
                    pass

    def execute_telnet_command(
        self,
        command: str,
        timeout: int = 20,
        idle_timeout: float = 1.0,
    ) -> Tuple[bool, str, str]:
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
                try:
                    tn.read_very_eager()
                except Exception:
                    pass

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

                output = buffer.decode("ascii", errors="ignore").strip()
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

    # =========================================================
    # STRATÉGIES DE FALLBACK
    # =========================================================

    def test_connection_preference(
        self,
        timeout: int = 10,
    ) -> Tuple[bool, Optional[Protocol], str]:
        started_at = time.perf_counter()

        if self.instance.protocol_preference == "telnet":
            ok, msg = self.test_telnet_connection(timeout=timeout)
            elapsed = round(time.perf_counter() - started_at, 2)
            logger.info(
                "[STRATEGY] Test terminé pour %s via préférence TELNET en %ss -> ok=%s",
                self.instance.host,
                elapsed,
                ok,
            )
            return ok, "telnet" if ok else None, msg

        ssh_ok, ssh_msg = self.test_ssh_connection(timeout=timeout)
        if ssh_ok:
            elapsed = round(time.perf_counter() - started_at, 2)
            logger.info(
                "[STRATEGY] Test terminé pour %s via SSH standard en %ss -> ok=True",
                self.instance.host,
                elapsed,
            )
            return True, "ssh", ssh_msg

        logger.info(
            "[STRATEGY] SSH standard indisponible pour %s. Tentative SSH legacy...",
            self.instance.host,
        )

        ssh_legacy_ok, ssh_legacy_msg = self.test_ssh_connection_legacy(timeout=timeout)
        if ssh_legacy_ok:
            elapsed = round(time.perf_counter() - started_at, 2)
            logger.info(
                "[STRATEGY] Test terminé pour %s via SSH legacy en %ss -> ok=True",
                self.instance.host,
                elapsed,
            )
            return True, "ssh-legacy", ssh_legacy_msg

        if self.instance.protocol_preference == "ssh":
            elapsed = round(time.perf_counter() - started_at, 2)
            logger.warning(
                "[STRATEGY] Test terminé pour %s après %ss -> SSH standard et legacy ont échoué.",
                self.instance.host,
                elapsed,
            )
            return False, None, f"SSH: {ssh_msg} ; SSH-LEGACY: {ssh_legacy_msg}"

        logger.info(
            "[STRATEGY] SSH indisponible pour %s. Tentative Telnet...",
            self.instance.host,
        )

        telnet_ok, telnet_msg = self.test_telnet_connection(timeout=timeout)
        elapsed = round(time.perf_counter() - started_at, 2)

        if telnet_ok:
            logger.info(
                "[STRATEGY] Test terminé pour %s via TELNET fallback en %ss -> ok=True",
                self.instance.host,
                elapsed,
            )
            return True, "telnet", telnet_msg

        logger.warning(
            "[STRATEGY] Test terminé pour %s après %ss -> tous les protocoles ont échoué.",
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

        logger.info(
            "[STRATEGY] SSH standard indisponible pour %s. Tentative SSH legacy...",
            self.instance.host,
        )

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
                "[STRATEGY] Commande terminée pour %s après %ss -> SSH standard et legacy ont échoué.",
                self.instance.host,
                elapsed,
            )
            return False, None, out, f"SSH: {err} ; SSH-LEGACY: {err_legacy}"

        logger.info(
            "[STRATEGY] SSH indisponible pour %s. Tentative Telnet...",
            self.instance.host,
        )

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


# =========================================================
# SESSION TELNET PERSISTANTE (unchanged)
# =========================================================

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
                "[TELNET-PERSIST] Échec ouverture session vers %s:%s après %ss : %s",
                self.instance.host,
                self.instance.telnet_port,
                elapsed,
                e,
            )
            return False, msg

    def close(self):
        self._cleanup()
        logger.info(
            "[TELNET-PERSIST] Session fermée pour %s:%s.",
            self.instance.host,
            self.instance.telnet_port,
        )

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

            output = buf.decode("ascii", errors="ignore").strip()
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