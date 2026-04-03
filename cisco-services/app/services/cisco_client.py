# app/services/cisco_client.py

"""
Cisco switch client — SSH + SSH-Legacy + Telnet.
Architecture identique à ISAMConnectionService.
"""

import logging
import re
import socket
import subprocess
import time
import telnetlib
from typing import List, Literal, Optional, Tuple

import paramiko

from app.models.cisco_switch import CiscoSwitch

logger = logging.getLogger(__name__)

Protocol = Literal["ssh", "ssh-legacy", "telnet"]


class CiscoConnectionService:
    """
    Service pour tester une connexion et exécuter une commande
    sur un switch Cisco donné (infos venant de CiscoSwitch).
    Architecture identique à ISAMConnectionService.
    """

    def __init__(self, switch: CiscoSwitch):
        self.switch = switch

    # ═══════════════════════════════════════════════════════
    #  TESTS DE CONNEXION
    # ═══════════════════════════════════════════════════════

    def test_ssh_connection(self, timeout: int = 10) -> Tuple[bool, str]:
        """Test SSH standard (avec algorithmes modernes)"""
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        try:
            logger.info(
                f"[SSH] Test connexion à "
                f"{self.switch.host}:{self.switch.ssh_port}..."
            )
            client.connect(
                hostname=self.switch.host,
                port=self.switch.ssh_port,
                username=self.switch.username,
                password=self.switch.password,
                look_for_keys=False,
                allow_agent=False,
                timeout=timeout,
            )
            msg = (
                f"[SSH] Connexion réussie à "
                f"{self.switch.host}:{self.switch.ssh_port}."
            )
            logger.info(msg)
            return True, msg

        except (
            socket.timeout,
            paramiko.ssh_exception.NoValidConnectionsError,
        ) as e:
            msg = f"[SSH] Impossible de se connecter : {e}"
            logger.error(msg)
            return False, msg
        except paramiko.AuthenticationException:
            msg = (
                f"[SSH] Erreur d'authentification pour "
                f"{self.switch.username}@{self.switch.host}."
            )
            logger.error(msg)
            return False, msg
        except Exception as e:
            msg = f"[SSH] Erreur inattendue : {e}"
            logger.exception(msg)
            return False, msg
        finally:
            client.close()

    def test_ssh_connection_legacy(
        self, timeout: int = 10
    ) -> Tuple[bool, str]:
        """Test SSH avec algorithmes legacy (ssh-rsa) — comme ISAM"""
        try:
            logger.info(
                f"[SSH-LEGACY] Test connexion à "
                f"{self.switch.host}:{self.switch.ssh_port} "
                f"avec algorithmes legacy..."
            )

            cmd = [
                "ssh",
                "-o", "HostKeyAlgorithms=+ssh-rsa",
                "-o", "PubkeyAcceptedAlgorithms=+ssh-rsa",
                "-o", "StrictHostKeyChecking=no",
                "-o", f"ConnectTimeout={timeout}",
                f"{self.switch.username}@{self.switch.host}",
                "-p", str(self.switch.ssh_port),
                "echo 'SSH Legacy connection successful'",
            ]

            result = subprocess.run(
                cmd,
                input=f"{self.switch.password}\n".encode(),
                capture_output=True,
                timeout=timeout + 5,
            )

            if result.returncode == 0:
                msg = (
                    "[SSH-LEGACY] Connexion réussie avec "
                    "algorithmes legacy."
                )
                logger.info(msg)
                return True, msg
            else:
                stderr = result.stderr.decode("utf-8", errors="ignore")
                msg = f"[SSH-LEGACY] Connexion échouée: {stderr}"
                logger.warning(msg)
                return False, msg

        except subprocess.TimeoutExpired:
            msg = "[SSH-LEGACY] Timeout lors de la connexion."
            logger.error(msg)
            return False, msg
        except Exception as e:
            msg = f"[SSH-LEGACY] Erreur inattendue : {e}"
            logger.exception(msg)
            return False, msg

    def test_telnet_connection(
        self, timeout: int = 10
    ) -> Tuple[bool, str]:
        """Test Telnet — détection du prompt Cisco (> ou #)"""
        try:
            logger.info(
                f"[TELNET] Test connexion à "
                f"{self.switch.host}:{self.switch.telnet_port}..."
            )
            with telnetlib.Telnet(
                self.switch.host,
                self.switch.telnet_port,
                timeout=timeout,
            ) as tn:
                # Cisco envoie "Username:" ou "login:"
                idx, _, text = tn.expect(
                    [b"sername:", b"ogin:", b">", b"#"],
                    timeout=timeout,
                )

                if b"sername" in text or b"ogin" in text:
                    tn.write(
                        self.switch.username.encode("ascii") + b"\n"
                    )
                    tn.expect([b"assword:"], timeout=timeout)
                    tn.write(
                        self.switch.password.encode("ascii") + b"\n"
                    )

                    time.sleep(2)
                    output = tn.read_very_eager().decode(
                        "ascii", errors="ignore"
                    )

                    if (
                        "#" in output
                        or ">" in output
                    ):
                        msg = (
                            "[TELNET] Connexion réussie, "
                            "prompt détecté."
                        )
                        logger.info(msg)
                        return True, msg

                    if (
                        "%" in output
                        or "failed" in output.lower()
                        or "invalid" in output.lower()
                    ):
                        msg = (
                            f"[TELNET] Erreur d'authentification pour "
                            f"{self.switch.username}@"
                            f"{self.switch.host}:{self.switch.telnet_port}."
                        )
                        logger.error(msg)
                        return False, msg

                    msg = (
                        "[TELNET] Connexion établie mais "
                        "prompt non reconnu."
                    )
                    logger.warning(msg + f" Output: {repr(output)}")
                    return False, msg

                # Got > or # directly (no auth required)
                msg = "[TELNET] Connexion réussie, prompt détecté."
                logger.info(msg)
                return True, msg

        except (socket.timeout, ConnectionRefusedError) as e:
            msg = (
                f"[TELNET] Impossible de se connecter "
                f"(timeout/refus) : {e}"
            )
            logger.error(msg)
            return False, msg
        except socket.gaierror as e:
            msg = (
                f"[TELNET] Résolution DNS échouée pour "
                f"'{self.switch.host}' — {e}"
            )
            logger.error(msg)
            return False, msg
        except Exception as e:
            msg = f"[TELNET] Erreur inattendue : {e}"
            logger.exception(msg)
            return False, msg

    # ═══════════════════════════════════════════════════════
    #  EXÉCUTION DE COMMANDES
    # ═══════════════════════════════════════════════════════

    def execute_ssh_command(
        self, command: str, enable: bool = False, timeout: int = 20
    ) -> Tuple[bool, str, str]:
        """
        Exécute une commande via SSH interactive shell.
        Cisco nécessite un shell interactif pour les commandes IOS
        (exec_command ne fonctionne pas sur la plupart des Cisco).
        """
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        try:
            logger.info(f"[SSH] Exécution commande: {command!r}")
            client.connect(
                hostname=self.switch.host,
                port=self.switch.ssh_port,
                username=self.switch.username,
                password=self.switch.password,
                look_for_keys=False,
                allow_agent=False,
                timeout=timeout,
            )

            shell = client.invoke_shell()
            shell.settimeout(timeout)

            # Attendre le prompt initial
            time.sleep(1)
            if shell.recv_ready():
                shell.recv(65535)

            # Mode enable si demandé
            if enable:
                shell.send("enable\n")
                time.sleep(1)
                if shell.recv_ready():
                    prompt = shell.recv(65535).decode(
                        "utf-8", errors="replace"
                    )
                    if "assword" in prompt:
                        enable_pwd = (
                            self.switch.enable_password
                            or self.switch.password
                        )
                        shell.send(enable_pwd + "\n")
                        time.sleep(1)
                        if shell.recv_ready():
                            resp = shell.recv(65535).decode(
                                "utf-8", errors="replace"
                            )
                            if (
                                "%" in resp
                                or "denied" in resp.lower()
                            ):
                                return (
                                    False,
                                    "",
                                    "Enable password rejeté par le switch.",
                                )

            # Désactiver la pagination
            shell.send("terminal length 0\n")
            time.sleep(1)
            if shell.recv_ready():
                shell.recv(65535)

            # Envoyer la commande
            shell.send(command + "\n")
            time.sleep(3)

            # Lire la sortie
            output = b""
            for _ in range(20):
                if shell.recv_ready():
                    output += shell.recv(65535)
                    time.sleep(0.5)
                else:
                    time.sleep(0.5)
                    if not shell.recv_ready():
                        break

            decoded = output.decode("utf-8", errors="replace")
            logger.info(
                "[SSH] Commande exécutée, longueur sortie: %d",
                len(decoded),
            )
            return True, decoded, ""

        except socket.timeout:
            msg = (
                f"[SSH] Timeout après {timeout}s pour "
                f"la commande: '{command}'"
            )
            logger.error(msg)
            return False, "", msg
        except paramiko.AuthenticationException:
            msg = (
                f"[SSH] Erreur d'authentification pour "
                f"{self.switch.username}@{self.switch.host}"
            )
            logger.error(msg)
            return False, "", msg
        except paramiko.SSHException as e:
            msg = (
                f"[SSH] Erreur protocole lors de "
                f"l'exécution de '{command}': {e}"
            )
            logger.error(msg)
            return False, "", msg
        except Exception as e:
            msg = (
                f"[SSH] Erreur inattendue lors de "
                f"l'exécution de '{command}': "
                f"{type(e).__name__}: {e}"
            )
            logger.exception(msg)
            return False, "", msg
        finally:
            client.close()

    def execute_ssh_command_legacy(
        self, command: str, timeout: int = 20
    ) -> Tuple[bool, str, str]:
        """Exécute une commande SSH avec algorithmes legacy"""
        try:
            logger.info(
                f"[SSH-LEGACY] Exécution commande: {command!r}"
            )

            cmd = [
                "ssh",
                "-o", "HostKeyAlgorithms=+ssh-rsa",
                "-o", "PubkeyAcceptedAlgorithms=+ssh-rsa",
                "-o", "StrictHostKeyChecking=no",
                "-o", f"ConnectTimeout={timeout}",
                "-tt",  # Force TTY for Cisco IOS
                f"{self.switch.username}@{self.switch.host}",
                "-p", str(self.switch.ssh_port),
                command,
            ]

            result = subprocess.run(
                cmd,
                input=f"{self.switch.password}\n".encode(),
                capture_output=True,
                timeout=timeout + 5,
            )

            out = result.stdout.decode("utf-8", errors="ignore")
            err = result.stderr.decode("utf-8", errors="ignore")

            if result.returncode == 0:
                logger.info(
                    "[SSH-LEGACY] Commande exécutée avec succès"
                )
                return True, out, err
            else:
                logger.warning(
                    f"[SSH-LEGACY] Commande retournée code "
                    f"{result.returncode}"
                )
                return False, out, err

        except subprocess.TimeoutExpired:
            msg = (
                "[SSH-LEGACY] Timeout lors de l'exécution "
                "de la commande."
            )
            logger.error(msg)
            return False, "", msg
        except Exception as e:
            msg = (
                f"[SSH-LEGACY] Erreur lors de l'exécution "
                f"de la commande : {e}"
            )
            logger.exception(msg)
            return False, "", msg

    def execute_telnet_command(
        self,
        command: str,
        enable: bool = False,
        timeout: int = 20,
        idle_timeout: float = 2.0,
    ) -> Tuple[bool, str, str]:
        """
        Exécute une commande via Telnet en lisant la sortie jusqu'à
        ce qu'il n'y ait plus de données pendant idle_timeout secondes,
        ou qu'on dépasse timeout au total.
        """
        try:
            logger.info(f"[TELNET] Exécution commande: {command!r}")
            with telnetlib.Telnet(
                self.switch.host,
                self.switch.telnet_port,
                timeout=timeout,
            ) as tn:
                # --- Login ---
                tn.expect(
                    [b"sername:", b"ogin:"], timeout=timeout
                )
                tn.write(
                    self.switch.username.encode("ascii") + b"\n"
                )

                tn.expect([b"assword:"], timeout=timeout)
                tn.write(
                    self.switch.password.encode("ascii") + b"\n"
                )

                # On laisse le prompt arriver puis on vide le buffer
                time.sleep(1)
                tn.read_very_eager()

                # Mode enable si demandé
                if enable:
                    tn.write(b"enable\n")
                    time.sleep(1)
                    resp = tn.read_very_eager().decode(
                        "utf-8", errors="replace"
                    )
                    if "assword" in resp:
                        enable_pwd = (
                            self.switch.enable_password
                            or self.switch.password
                        )
                        tn.write(
                            enable_pwd.encode("ascii") + b"\n"
                        )
                        time.sleep(1)
                        enable_resp = tn.read_very_eager().decode(
                            "utf-8", errors="replace"
                        )
                        if (
                            "%" in enable_resp
                            or "denied" in enable_resp.lower()
                        ):
                            return (
                                False,
                                "",
                                "Enable password rejeté par le switch.",
                            )

                # Désactiver la pagination
                tn.write(b"terminal length 0\n")
                time.sleep(1)
                tn.read_very_eager()

                # --- Envoi de la commande ---
                for line in command.split("\n"):
                    line = line.strip()
                    if not line:
                        continue
                    tn.write(line.encode("ascii") + b"\n")
                    time.sleep(0.2)

                # --- Lecture de la sortie ---
                time.sleep(1)  # post_send_delay
                end_time = time.time() + timeout
                last_data_time = time.time()
                buffer = b""

                while time.time() < end_time:
                    chunk = tn.read_very_eager()
                    if chunk:
                        buffer += chunk
                        last_data_time = time.time()
                    else:
                        if buffer and (
                            time.time() - last_data_time
                        ) > idle_timeout:
                            break
                        time.sleep(0.2)

                output = buffer.decode("utf-8", errors="replace")
                logger.info("[TELNET] Commande exécutée.")
                return True, output, ""

        except (socket.timeout, ConnectionRefusedError) as e:
            msg = (
                f"[TELNET] Impossible de se connecter "
                f"(timeout/refus) : {e}"
            )
            logger.error(msg)
            return False, "", msg
        except EOFError as e:
            msg = (
                f"[TELNET] Connexion fermée pendant "
                f"'{command}': {e}"
            )
            logger.error(msg)
            return False, "", msg
        except Exception as e:
            msg = (
                f"[TELNET] Erreur lors de l'exécution "
                f"de la commande : {e}"
            )
            logger.exception(msg)
            return False, "", msg

    # ═══════════════════════════════════════════════════════
    #  TESTS AVEC STRATÉGIES (identique à ISAM)
    # ═══════════════════════════════════════════════════════

    def test_connection_preference(
        self, timeout: int = 10
    ) -> Tuple[bool, Optional[str], str]:
        """
        Stratégie identique à ISAMConnectionService :
        SSH → SSH-Legacy → Telnet (si auto)
        """
        # Préférence Telnet uniquement
        if self.switch.protocol_preference == "telnet":
            ok, msg = self.test_telnet_connection(timeout=timeout)
            return ok, "telnet" if ok else None, msg

        # Essai SSH standard
        ssh_ok, ssh_msg = self.test_ssh_connection(timeout=timeout)
        if ssh_ok:
            return True, "ssh", ssh_msg

        # SSH legacy
        logger.info(
            "[STRATEGY] SSH standard échoué, "
            "tentative SSH legacy..."
        )
        ssh_legacy_ok, ssh_legacy_msg = (
            self.test_ssh_connection_legacy(timeout=timeout)
        )
        if ssh_legacy_ok:
            return True, "ssh-legacy", ssh_legacy_msg

        # Si préférence SSH uniquement, on s'arrête
        if self.switch.protocol_preference == "ssh":
            return (
                False,
                None,
                f"SSH: {ssh_msg} ; SSH-LEGACY: {ssh_legacy_msg}",
            )

        # Auto : fallback Telnet
        logger.info(
            "[STRATEGY] SSH échoué, tentative Telnet..."
        )
        telnet_ok, telnet_msg = self.test_telnet_connection(
            timeout=timeout
        )
        if telnet_ok:
            return True, "telnet", telnet_msg

        return (
            False,
            None,
            f"SSH: {ssh_msg} ; SSH-LEGACY: {ssh_legacy_msg} "
            f"; TELNET: {telnet_msg}",
        )

    def execute_command_preference(
        self,
        command: str,
        enable: bool = False,
        timeout: int = 20,
    ) -> Tuple[bool, Optional[str], str, str]:
        """
        Stratégie d'exécution identique à ISAMConnectionService :
        SSH → SSH-Legacy → Telnet (si auto)
        """
        # Préférence Telnet uniquement
        if self.switch.protocol_preference == "telnet":
            ok, out, err = self.execute_telnet_command(
                command, enable=enable, timeout=timeout
            )
            return ok, "telnet" if ok else None, out, err

        # Essai SSH standard
        ok, out, err = self.execute_ssh_command(
            command, enable=enable, timeout=timeout
        )
        if ok:
            return True, "ssh", out, err

        # SSH legacy
        logger.info(
            "[STRATEGY] SSH standard échoué, "
            "tentative SSH legacy..."
        )
        ok_legacy, out_legacy, err_legacy = (
            self.execute_ssh_command_legacy(command, timeout=timeout)
        )
        if ok_legacy:
            return True, "ssh-legacy", out_legacy, err_legacy

        # Si préférence SSH uniquement, on s'arrête
        if self.switch.protocol_preference == "ssh":
            return (
                False,
                None,
                out,
                f"SSH: {err} ; SSH-LEGACY: {err_legacy}",
            )

        # Auto : fallback Telnet
        logger.info(
            "[STRATEGY] SSH échoué, tentative Telnet..."
        )
        ok_tel, out_tel, msg_tel = self.execute_telnet_command(
            command, enable=enable, timeout=timeout
        )
        if ok_tel:
            return True, "telnet", out_tel, msg_tel

        return (
            False,
            None,
            "",
            f"SSH: {err} ; SSH-LEGACY: {err_legacy} "
            f"; TELNET: {msg_tel}",
        )

    # ═══════════════════════════════════════════════════════
    #  PORT STATUS / CONFIG / VLAN CHANGE
    # ═══════════════════════════════════════════════════════

    def get_all_port_status(
        self, timeout: int = 20
    ) -> Tuple[bool, Optional[str], List[dict], Optional[str]]:
        """
        Returns (success, protocol_used, ports_list, error).
        """
        ok, proto, output, err = self.execute_command_preference(
            "show interfaces status", timeout=timeout
        )
        if not ok:
            return False, proto, [], err

        ports = parse_interfaces_status(output)

        # Essayer de récupérer les MAC (best-effort)
        try:
            mac_ok, _, mac_out, _ = self.execute_command_preference(
                "show mac address-table", timeout=15
            )
            if mac_ok and mac_out:
                mac_map = parse_mac_table(mac_out)
                for p in ports:
                    p["mac_address"] = mac_map.get(p["port_label"])
        except Exception as e:
            logger.debug("MAC table fetch ignoré: %s", e)

        return True, proto, ports, None

    def get_port_running_config(
        self, port_label: str, timeout: int = 15
    ) -> Tuple[bool, Optional[str], str, Optional[str]]:
        """Returns (success, protocol_used, output, error)."""
        full_name = expand_interface_name(port_label)
        cmd = f"show running-config interface {full_name}"
        return self.execute_command_preference(cmd, timeout=timeout)

    def change_vlan(
        self,
        port_label: str,
        new_vlan: str,
        vlan_type: str = "Access",
        description: str = "",
        timeout: int = 30,
    ) -> Tuple[bool, Optional[str], str, Optional[str]]:
        """
        Change VLAN on a port. Uses config mode commands.
        Returns (success, protocol_used, output, error).
        """
        full_name = expand_interface_name(port_label)

        if vlan_type.lower() == "trunk":
            commands = [
                "conf t",
                f"interface {full_name}",
                "switchport mode trunk",
                "no switchport access vlan",
                f"switchport trunk allowed vlan {new_vlan}",
            ]
            if description:
                commands.append(f"description {description}")
            commands.append("end")
        else:
            commands = [
                "conf t",
                f"interface {full_name}",
                "switchport mode access",
                "no switchport trunk allowed vlan",
                f"switchport access vlan {new_vlan}",
            ]
            if description:
                commands.append(f"description VLAN_{description}")
            commands.append("end")

        script = "\n".join(commands)

        # Préférence Telnet
        if self.switch.protocol_preference == "telnet":
            ok, out, err = self.execute_telnet_command(
                script, enable=True, timeout=timeout
            )
            return ok, "telnet" if ok else None, out, err

        # SSH config
        ok, out, err = self._ssh_config_commands(commands, timeout)
        if ok:
            return True, "ssh", out, err

        # SSH uniquement → arrêt
        if self.switch.protocol_preference == "ssh":
            return False, None, out, err

        # Auto : fallback Telnet
        logger.info(
            "[STRATEGY] SSH config échoué, tentative Telnet..."
        )
        ok_t, out_t, err_t = self.execute_telnet_command(
            script, enable=True, timeout=timeout
        )
        if ok_t:
            return True, "telnet", out_t, err_t

        return (
            False,
            None,
            "",
            f"SSH: {err} ; TELNET: {err_t}",
        )

    def _ssh_config_commands(
        self, commands: List[str], timeout: int = 30
    ) -> Tuple[bool, str, str]:
        """Envoie des commandes de config via SSH interactive shell."""
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        try:
            client.connect(
                hostname=self.switch.host,
                port=self.switch.ssh_port,
                username=self.switch.username,
                password=self.switch.password,
                look_for_keys=False,
                allow_agent=False,
                timeout=timeout,
            )
            shell = client.invoke_shell()
            shell.settimeout(timeout)

            time.sleep(1)
            if shell.recv_ready():
                shell.recv(65535)

            # Désactiver la pagination
            shell.send("terminal length 0\n")
            time.sleep(0.5)
            if shell.recv_ready():
                shell.recv(65535)

            # Envoyer les commandes une par une
            for cmd in commands:
                shell.send(cmd.strip() + "\n")
                time.sleep(0.3)

            time.sleep(2)
            output = b""
            for _ in range(15):
                if shell.recv_ready():
                    output += shell.recv(65535)
                    time.sleep(0.3)
                else:
                    time.sleep(0.3)
                    if not shell.recv_ready():
                        break

            decoded = output.decode("utf-8", errors="replace")

            if "% Invalid" in decoded or "% Incomplete" in decoded:
                return (
                    False,
                    decoded,
                    "Le switch a retourné une erreur.",
                )

            return True, decoded, ""

        except Exception as e:
            msg = (
                f"[SSH-CONFIG] Erreur : "
                f"{type(e).__name__}: {e}"
            )
            logger.error(msg)
            return False, "", msg
        finally:
            client.close()


# ═══════════════════════════════════════════════════════════════════
#  SESSION TELNET PERSISTANTE (multi-commandes sur une seule
#  connexion) — identique à ISAMPersistentTelnet
# ═══════════════════════════════════════════════════════════════════


class CiscoPersistentTelnet:
    """
    Session Telnet persistante pour Cisco : UNE connexion, N commandes.

    Résout les mêmes problèmes que ISAMPersistentTelnet :
      1. Saturation des sessions (limite de sessions simultanées)
      2. idle_timeout trop court
    """

    def __init__(self, switch: CiscoSwitch, timeout: int = 30):
        self.switch = switch
        self.timeout = timeout
        self._tn: Optional[telnetlib.Telnet] = None
        self._connected = False

    @property
    def connected(self) -> bool:
        return self._connected

    # ── connect ─────────────────────────────────────────

    def connect(self) -> Tuple[bool, str]:
        """
        Ouvre la connexion Telnet et effectue le login
        UNE SEULE FOIS.
        """
        try:
            logger.info(
                "[TELNET-PERSIST] Ouverture session vers %s:%s …",
                self.switch.host,
                self.switch.telnet_port,
            )
            self._tn = telnetlib.Telnet(
                self.switch.host,
                self.switch.telnet_port,
                timeout=self.timeout,
            )

            # ── Login ────────────────────────────────────
            idx, _, _ = self._tn.expect(
                [
                    b"sername:",
                    b"Username:",
                    b"ogin:",
                    b"Login:",
                ],
                timeout=self.timeout,
            )
            if idx == -1:
                self._cleanup()
                return (
                    False,
                    "[TELNET-PERSIST] Prompt login non détecté.",
                )

            self._tn.write(
                self.switch.username.encode("ascii") + b"\n"
            )

            idx2, _, _ = self._tn.expect(
                [b"Password:", b"password:", b"assword:"],
                timeout=self.timeout,
            )
            if idx2 == -1:
                self._cleanup()
                return (
                    False,
                    "[TELNET-PERSIST] Prompt password non détecté.",
                )

            self._tn.write(
                self.switch.password.encode("ascii") + b"\n"
            )

            # Laisser le MOTD / bannière arriver
            time.sleep(2.0)
            try:
                initial = self._tn.read_very_eager().decode(
                    "ascii", errors="ignore"
                )
                # Vérifier l'authentification
                if (
                    "%" in initial
                    or "failed" in initial.lower()
                    or "invalid" in initial.lower()
                ):
                    self._cleanup()
                    return (
                        False,
                        "[TELNET-PERSIST] Authentification échouée.",
                    )
            except Exception:
                pass

            # Désactiver la pagination
            self._tn.write(b"terminal length 0\n")
            time.sleep(0.5)
            try:
                self._tn.read_very_eager()
            except Exception:
                pass

            self._connected = True
            msg = "[TELNET-PERSIST] Session ouverte avec succès."
            logger.info(msg)
            return True, msg

        except Exception as e:
            self._cleanup()
            msg = f"[TELNET-PERSIST] Échec connexion : {e}"
            logger.exception(msg)
            return False, msg

    # ── close ───────────────────────────────────────────

    def close(self):
        """Ferme proprement la session."""
        self._cleanup()
        logger.info("[TELNET-PERSIST] Session fermée.")

    def _cleanup(self):
        if self._tn:
            try:
                self._tn.close()
            except Exception:
                pass
            self._tn = None
        self._connected = False

    # ── exécution d'une commande ────────────────────────

    def execute(
        self,
        command: str,
        idle_timeout: float = 3.0,
        post_send_delay: float = 1.0,
    ) -> Tuple[bool, str, str]:
        """
        Exécute une commande sur la session déjà ouverte.

        Paramètres :
          - idle_timeout : secondes sans nouvelles données
            avant d'arrêter la lecture
          - post_send_delay : pause après envoi de la commande
            avant de commencer à lire

        Retourne (success, output, error_message).
        """
        if not self._connected or not self._tn:
            return (
                False,
                "",
                "[TELNET-PERSIST] Session non connectée.",
            )

        try:
            # Vider d'éventuels résidus du buffer
            try:
                self._tn.read_very_eager()
            except Exception:
                pass

            logger.debug("[TELNET-PERSIST] >>> %r", command)

            # Envoi de la commande (support multi-lignes)
            for line in command.split("\n"):
                line = line.strip()
                if not line:
                    continue
                self._tn.write(line.encode("ascii") + b"\n")
                time.sleep(0.3)

            # ── Pause post-envoi ─────────────────────────
            time.sleep(post_send_delay)

            # ── Lecture de la réponse ────────────────────
            end_time = time.time() + self.timeout
            last_data_time = time.time()
            buf = b""

            while time.time() < end_time:
                try:
                    chunk = self._tn.read_very_eager()
                except EOFError:
                    self._connected = False
                    logger.warning(
                        "[TELNET-PERSIST] Connexion fermée "
                        "par le switch."
                    )
                    break

                if chunk:
                    buf += chunk
                    last_data_time = time.time()
                else:
                    if buf and (
                        time.time() - last_data_time
                    ) > idle_timeout:
                        break
                    time.sleep(0.2)

            output = buf.decode("ascii", errors="ignore")
            logger.debug(
                "[TELNET-PERSIST] <<< %d octets pour %r",
                len(buf),
                command,
            )
            return True, output, ""

        except Exception as e:
            self._connected = False
            msg = f"[TELNET-PERSIST] Erreur exécution : {e}"
            logger.exception(msg)
            return False, "", msg

    # ── context-manager ─────────────────────────────────

    def __enter__(self):
        ok, msg = self.connect()
        if not ok:
            raise ConnectionError(msg)
        return self

    def __exit__(self, *exc):
        self.close()


# ═══════════════════════════════════════════════════════════════════
#  PARSERS
# ═══════════════════════════════════════════════════════════════════


def parse_show_version(output: str) -> dict:
    """Parse 'show version' en données structurées."""
    info: dict = {
        "hostname": None,
        "model": None,
        "ios_version": None,
        "serial_number": None,
        "uptime": None,
    }

    try:
        m = re.search(r"(\S+)\s+uptime is", output)
        if m:
            info["hostname"] = m.group(1)
    except Exception as e:
        logger.debug("Parse hostname échoué: %s", e)

    try:
        m = re.search(
            r"[Cc]isco\s+([\w\-]+).*(?:processor|bytes of memory)",
            output,
        )
        if m:
            info["model"] = m.group(1)
    except Exception as e:
        logger.debug("Parse model échoué: %s", e)

    try:
        m = re.search(
            r"(?:Cisco IOS|IOS).+?Version\s+([\S]+)", output
        )
        if m:
            info["ios_version"] = m.group(1).rstrip(",")
    except Exception as e:
        logger.debug("Parse IOS version échoué: %s", e)

    try:
        m = re.search(
            r"[Pp]rocessor\s+board\s+ID\s+(\S+)", output
        )
        if m:
            info["serial_number"] = m.group(1)
    except Exception as e:
        logger.debug("Parse serial échoué: %s", e)

    try:
        m = re.search(r"uptime is\s+(.+)", output)
        if m:
            info["uptime"] = m.group(1).strip()
    except Exception as e:
        logger.debug("Parse uptime échoué: %s", e)

    return info


def parse_interfaces(output: str) -> List[dict]:
    """Parse 'show ip interface brief'."""
    interfaces: List[dict] = []
    try:
        for line in output.strip().split("\n"):
            m = re.match(
                r"(\S+)\s+"
                r"(\d+\.\d+\.\d+\.\d+|unassigned)\s+"
                r"\S+\s+\S+\s+"
                r"(\S+(?:\s+\S+)?)\s+"
                r"(\S+)",
                line.strip(),
            )
            if m:
                interfaces.append(
                    {
                        "name": m.group(1),
                        "ip_address": (
                            m.group(2)
                            if m.group(2) != "unassigned"
                            else None
                        ),
                        "status": m.group(3),
                        "protocol": m.group(4),
                    }
                )
    except Exception as e:
        logger.warning("Échec parsing interfaces: %s", e)

    return interfaces


def parse_vlans(output: str) -> List[dict]:
    """Parse 'show vlan brief'."""
    vlans: List[dict] = []
    try:
        for line in output.strip().split("\n"):
            m = re.match(
                r"(\d+)\s+(\S+)\s+(active|act/unsup|suspend)"
                r"\s*(.*)",
                line.strip(),
            )
            if m:
                ports = [
                    p.strip()
                    for p in m.group(4).split(",")
                    if p.strip()
                ]
                vlans.append(
                    {
                        "id": int(m.group(1)),
                        "name": m.group(2),
                        "status": m.group(3),
                        "ports": ports,
                    }
                )
    except Exception as e:
        logger.warning("Échec parsing VLANs: %s", e)

    return vlans


def parse_running_config_vlan(output: str) -> Optional[str]:
    """Extrait le VLAN courant du running-config interface."""
    m = re.search(r"switchport access vlan (\d+)", output)
    if m:
        return "Access " + m.group(1)
    m = re.search(r"switchport trunk allowed (.+)", output)
    if m:
        return "Trunk " + m.group(1).strip()
    return None


def expand_interface_name(abbrev: str) -> str:
    """Gi1/0/1 → GigabitEthernet1/0/1"""
    for short, full in {
        "Gi": "GigabitEthernet",
        "Fa": "FastEthernet",
        "Te": "TenGigabitEthernet",
        "Tw": "TwentyFiveGigE",
        "Fo": "FortyGigabitEthernet",
        "Po": "Port-channel",
    }.items():
        if abbrev.startswith(short) and not abbrev.startswith(full):
            return full + abbrev[len(short):]
    return abbrev


def extract_port_number(label: str) -> int:
    """Gi1/0/23 → 23"""
    parts = label.split("/")
    if parts:
        m = re.search(r"(\d+)$", parts[-1])
        if m:
            return int(m.group(1))
    return 0


def parse_interfaces_status(output: str) -> List[dict]:
    """Parse 'show interfaces status'."""
    ports: List[dict] = []
    status_keywords = (
        "connected",
        "notconnect",
        "disabled",
        "err-disabled",
        "monitoring",
        "inactive",
        "sfpAbsent",
        "xcvrAbsen",
        "down",
        "up",
    )
    pattern = re.compile(
        r"^(\S+)\s+"
        r"(.*?)\s+"
        r"(" + "|".join(status_keywords) + r")\s+"
        r"(\S+)\s+"
        r"(\S+)\s+"
        r"(\S+)"
        r"(?:\s+(.+))?$"
    )
    physical_prefixes = (
        "Gi", "Fa", "Te", "Tw", "Fo", "Hu", "Et",
    )

    for line in output.strip().split("\n"):
        line = line.rstrip()
        if (
            not line
            or line.startswith("Port")
            or line.startswith("-")
        ):
            continue
        m = pattern.match(line)
        if not m:
            continue
        port_label = m.group(1)
        if not port_label.startswith(physical_prefixes):
            continue
        ports.append(
            {
                "port_label": port_label,
                "port_number": extract_port_number(port_label),
                "description": m.group(2).strip(),
                "status": m.group(3),
                "vlan": m.group(4),
                "duplex": m.group(5),
                "speed": m.group(6),
                "port_type": (m.group(7) or "").strip(),
            }
        )
    return ports


def parse_mac_table(output: str) -> dict:
    """Parse 'show mac address-table' → {port_label: mac}."""
    mac_map: dict = {}
    for line in output.strip().split("\n"):
        m = re.match(
            r"\s*\d+\s+"
            r"([0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4})"
            r"\s+\S+\s+(\S+)",
            line.strip(),
        )
        if m:
            raw = m.group(1).replace(".", "")
            mac = ":".join(
                raw[i : i + 2].upper() for i in range(0, 12, 2)
            )
            mac_map[m.group(2)] = mac
    return mac_map


# ═══════════════════════════════════════════════════════════════════
#  Helper pour les health-checks
# ═══════════════════════════════════════════════════════════════════


def test_connection_for_switch(
    switch: CiscoSwitch, timeout: int = 10
) -> Tuple[bool, Optional[str], str, int]:
    """
    Helper pour les health-checks.
    Retourne (success, protocol_used, message, response_time_ms)
    """
    service = CiscoConnectionService(switch)
    start = time.time()
    ok, proto, msg = service.test_connection_preference(timeout=timeout)
    duration_ms = int((time.time() - start) * 1000)
    return ok, proto, msg, duration_ms