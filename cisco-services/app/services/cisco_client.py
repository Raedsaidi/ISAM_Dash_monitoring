# app/services/cisco_client.py

"""
Cisco switch client — SSH + SSH-Legacy + Telnet.
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

    def __init__(self, switch: CiscoSwitch):
        self.switch = switch

    # ═══════════════════════════════════════════════════════
    #  CONNECTION TESTS
    # ═══════════════════════════════════════════════════════

    def test_ssh_connection(self, timeout: int = 10) -> Tuple[bool, str]:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            logger.info(
                "[SSH] Test connexion à %s:%s…",
                self.switch.host, self.switch.ssh_port,
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
        try:
            logger.info(
                "[SSH-LEGACY] Test connexion à %s:%s avec algorithmes legacy…",
                self.switch.host, self.switch.ssh_port,
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
                msg = "[SSH-LEGACY] Connexion réussie avec algorithmes legacy."
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
        try:
            logger.info(
                "[TELNET] Test connexion à %s:%s…",
                self.switch.host, self.switch.telnet_port,
            )
            with telnetlib.Telnet(
                self.switch.host,
                self.switch.telnet_port,
                timeout=timeout,
            ) as tn:
                idx, _, text = tn.expect(
                    [b"sername:", b"ogin:", b">", b"#"],
                    timeout=timeout,
                )
                if b"sername" in text or b"ogin" in text:
                    tn.write(self.switch.username.encode("ascii") + b"\n")
                    tn.expect([b"assword:"], timeout=timeout)
                    tn.write(self.switch.password.encode("ascii") + b"\n")
                    time.sleep(2)
                    output = tn.read_very_eager().decode("ascii", errors="ignore")
                    if "#" in output or ">" in output:
                        msg = "[TELNET] Connexion réussie, prompt détecté."
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
                    msg = "[TELNET] Connexion établie mais prompt non reconnu."
                    logger.warning("%s Output: %r", msg, output)
                    return False, msg
                msg = "[TELNET] Connexion réussie, prompt détecté."
                logger.info(msg)
                return True, msg
        except (socket.timeout, ConnectionRefusedError) as e:
            msg = f"[TELNET] Impossible de se connecter (timeout/refus) : {e}"
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
    #  COMMAND EXECUTION
    # ═══════════════════════════════════════════════════════

    def execute_ssh_command(
        self, command: str, enable: bool = False, timeout: int = 20
    ) -> Tuple[bool, str, str]:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            logger.info("[SSH] Exécution commande: %r", command)
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

            if enable:
                shell.send("enable\n")
                time.sleep(1)
                if shell.recv_ready():
                    prompt = shell.recv(65535).decode("utf-8", errors="replace")
                    if "assword" in prompt:
                        enable_pwd = (
                            self.switch.enable_password or self.switch.password
                        )
                        shell.send(enable_pwd + "\n")
                        time.sleep(1)
                        if shell.recv_ready():
                            resp = shell.recv(65535).decode(
                                "utf-8", errors="replace"
                            )
                            if "%" in resp or "denied" in resp.lower():
                                return (
                                    False,
                                    "",
                                    "Enable password rejeté par le switch.",
                                )

            shell.send("terminal length 0\n")
            time.sleep(1)
            if shell.recv_ready():
                shell.recv(65535)

            shell.send(command + "\n")
            time.sleep(3)

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
                "[SSH] Commande exécutée, longueur sortie: %d", len(decoded)
            )
            return True, decoded, ""

        except socket.timeout:
            msg = (
                f"[SSH] Timeout après {timeout}s "
                f"pour la commande: '{command}'"
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
        try:
            logger.info("[SSH-LEGACY] Exécution commande: %r", command)
            cmd = [
                "ssh",
                "-o", "HostKeyAlgorithms=+ssh-rsa",
                "-o", "PubkeyAcceptedAlgorithms=+ssh-rsa",
                "-o", "StrictHostKeyChecking=no",
                "-o", f"ConnectTimeout={timeout}",
                "-tt",
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
                logger.info("[SSH-LEGACY] Commande exécutée avec succès")
                return True, out, err
            else:
                logger.warning(
                    "[SSH-LEGACY] Commande retournée code %d",
                    result.returncode,
                )
                return False, out, err
        except subprocess.TimeoutExpired:
            msg = "[SSH-LEGACY] Timeout lors de l'exécution de la commande."
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
        try:
            logger.info("[TELNET] Exécution commande: %r", command)
            with telnetlib.Telnet(
                self.switch.host,
                self.switch.telnet_port,
                timeout=timeout,
            ) as tn:
                tn.expect([b"sername:", b"ogin:"], timeout=timeout)
                tn.write(self.switch.username.encode("ascii") + b"\n")
                tn.expect([b"assword:"], timeout=timeout)
                tn.write(self.switch.password.encode("ascii") + b"\n")

                time.sleep(1)
                tn.read_very_eager()

                if enable:
                    tn.write(b"enable\n")
                    time.sleep(1)
                    resp = tn.read_very_eager().decode(
                        "utf-8", errors="replace"
                    )
                    if "assword" in resp:
                        enable_pwd = (
                            self.switch.enable_password or self.switch.password
                        )
                        tn.write(enable_pwd.encode("ascii") + b"\n")
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

                tn.write(b"terminal length 0\n")
                time.sleep(1)
                tn.read_very_eager()

                for line in command.split("\n"):
                    line = line.strip()
                    if not line:
                        continue
                    tn.write(line.encode("ascii") + b"\n")
                    time.sleep(0.2)

                time.sleep(1)
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
            msg = f"[TELNET] Connexion fermée pendant '{command}': {e}"
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
    #  STRATEGY METHODS
    # ═══════════════════════════════════════════════════════

    def test_connection_preference(
        self, timeout: int = 10
    ) -> Tuple[bool, Optional[str], str]:
        if self.switch.protocol_preference == "telnet":
            ok, msg = self.test_telnet_connection(timeout=timeout)
            return ok, "telnet" if ok else None, msg

        ssh_ok, ssh_msg = self.test_ssh_connection(timeout=timeout)
        if ssh_ok:
            return True, "ssh", ssh_msg

        logger.info(
            "[STRATEGY] SSH standard échoué, tentative SSH legacy…"
        )
        ssh_legacy_ok, ssh_legacy_msg = self.test_ssh_connection_legacy(
            timeout=timeout
        )
        if ssh_legacy_ok:
            return True, "ssh-legacy", ssh_legacy_msg

        if self.switch.protocol_preference == "ssh":
            return (
                False,
                None,
                f"SSH: {ssh_msg} ; SSH-LEGACY: {ssh_legacy_msg}",
            )

        logger.info("[STRATEGY] SSH échoué, tentative Telnet…")
        telnet_ok, telnet_msg = self.test_telnet_connection(timeout=timeout)
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
        if self.switch.protocol_preference == "telnet":
            ok, out, err = self.execute_telnet_command(
                command, enable=enable, timeout=timeout
            )
            return ok, "telnet" if ok else None, out, err

        ok, out, err = self.execute_ssh_command(
            command, enable=enable, timeout=timeout
        )
        if ok:
            return True, "ssh", out, err

        logger.info(
            "[STRATEGY] SSH standard échoué, tentative SSH legacy…"
        )
        ok_legacy, out_legacy, err_legacy = self.execute_ssh_command_legacy(
            command, timeout=timeout
        )
        if ok_legacy:
            return True, "ssh-legacy", out_legacy, err_legacy

        if self.switch.protocol_preference == "ssh":
            return (
                False,
                None,
                out,
                f"SSH: {err} ; SSH-LEGACY: {err_legacy}",
            )

        logger.info("[STRATEGY] SSH échoué, tentative Telnet…")
        ok_tel, out_tel, msg_tel = self.execute_telnet_command(
            command, enable=enable, timeout=timeout
        )
        if ok_tel:
            return True, "telnet", out_tel, msg_tel

        return (
            False,
            None,
            "",
            f"SSH: {err} ; SSH-LEGACY: {err_legacy} ; TELNET: {msg_tel}",
        )

    # ═══════════════════════════════════════════════════════
    #  PORT STATUS / CONFIG
    # ═══════════════════════════════════════════════════════

    def get_all_port_status(
        self, timeout: int = 20
    ) -> Tuple[bool, Optional[str], List[dict], Optional[str]]:
        ok, proto, output, err = self.execute_command_preference(
            "show interfaces status", timeout=timeout
        )
        if not ok:
            return False, proto, [], err

        ports = parse_interfaces_status(output)

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
        full_name = expand_interface_name(port_label)
        cmd = f"show running-config interface {full_name}"
        return self.execute_command_preference(cmd, timeout=timeout)

    # ═══════════════════════════════════════════════════════
    #  SSH CONFIG SESSION — prompt-based
    # ═══════════════════════════════════════════════════════

    def _ssh_config_commands(
        self, commands: List[str], timeout: int = 30
    ) -> Tuple[bool, str, str]:
        """
        Execute IOS configuration commands via SSH interactive shell.
        Handles: connect → enable → terminal length 0 → conf t →
                 [terminal]? confirm → commands → end
        """
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        try:
            logger.info(
                "[SSH-CFG] Connecting to %s:%s for config session…",
                self.switch.host, self.switch.ssh_port,
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
            shell = client.invoke_shell(width=200, height=200)
            shell.settimeout(timeout)

            all_output = ""

            # ── raw reader ────────────────────────────────────────────
            def _read_all(pause: float = 0.5) -> str:
                time.sleep(pause)
                buf = ""
                while shell.recv_ready():
                    chunk = shell.recv(65535).decode("utf-8", errors="replace")
                    buf += chunk
                    time.sleep(0.1)
                logger.info("[SSH-CFG] RAW READ: %r", buf)
                return buf

            # ── send a line and read the response ─────────────────────
            def _send(line: str, pause: float = 1.0) -> str:
                logger.info("[SSH-CFG] SEND: %r", line)
                shell.send(line)
                return _read_all(pause)

            # ── Step 1: wait for initial prompt ───────────────────────
            logger.info("[SSH-CFG] Waiting for initial prompt…")
            out = _read_all(3.0)
            all_output += out

            if "#" not in out and ">" not in out:
                out2 = _read_all(3.0)
                all_output += out2
                if "#" not in out2 and ">" not in out2:
                    return (
                        False,
                        all_output,
                        f"No initial prompt received. Got: {repr(all_output[-300:])}",
                    )

            # ── Step 2: enter enable ──────────────────────────────────
            out = _send("enable\n", pause=1.5)
            all_output += out

            if "assword" in out or "Password" in out:
                enable_pwd = self.switch.enable_password or self.switch.password
                out2 = _send(enable_pwd + "\n", pause=1.5)
                all_output += out2
                if "%" in out2 or "denied" in out2.lower():
                    return (
                        False,
                        all_output,
                        "Enable password rejected by switch.",
                    )

            if "#" not in all_output.split("\n")[-1]:
                out3 = _read_all(1.0)
                all_output += out3

            logger.info(
                "[SSH-CFG] After enable — tail: %r", all_output[-200:]
            )

            # ── Step 3: terminal length 0 ─────────────────────────────
            out = _send("terminal length 0\n", pause=1.0)
            all_output += out
            logger.info(
                "[SSH-CFG] After terminal length 0 — tail: %r", out[-200:]
            )

            # ── Step 4: conf t ────────────────────────────────────────
            out = _send("conf t\n", pause=2.0)
            all_output += out
            logger.info("[SSH-CFG] After conf t — raw: %r", out)

            # ── Step 5: handle [terminal]? prompt ─────────────────────
            if (
                "terminal]?" in out
                or "memory, or network" in out.lower()
                or "configuring from" in out.lower()
            ):
                logger.info(
                    "[SSH-CFG] Detected config-source prompt — pressing Enter"
                )
                out2 = _send("\n", pause=2.0)
                all_output += out2
                logger.info(
                    "[SSH-CFG] After Enter for [terminal]? — raw: %r", out2
                )
                if "(config)#" not in out2 and "config)#" not in out2:
                    out3 = _read_all(2.0)
                    all_output += out3
                    logger.info(
                        "[SSH-CFG] Extra read after [terminal]? — raw: %r",
                        out3,
                    )
                    if "(config)#" not in out3 and "config)#" not in out3:
                        return (
                            False,
                            all_output,
                            "IOS did not reach (config)# after confirming "
                            f"config source. Got: {repr(out3[-300:])}",
                        )

            elif "(config)#" not in out and "config)#" not in out:
                logger.info(
                    "[SSH-CFG] (config)# not seen yet — waiting more…"
                )
                out2 = _read_all(2.0)
                all_output += out2
                logger.info(
                    "[SSH-CFG] Extra read for (config)# — raw: %r", out2
                )
                if "(config)#" not in out2 and "config)#" not in out2:
                    return (
                        False,
                        all_output,
                        "IOS did not reach (config)# after 'conf t'. "
                        f"Got: {repr(out2[-300:])}",
                    )

            logger.info(
                "[SSH-CFG] ✓ Now in (config)# mode — sending %d commands",
                len([c for c in commands if c.strip()]),
            )

            # ── Step 6: send each config command ──────────────────────
            config_indicators = [
                "(config)#",
                "(config-if)#",
                "(config-vlan)#",
                "(config-line)#",
                "(config-router)#",
                "config)#",
            ]

            for cmd in commands:
                cmd = cmd.strip()
                if not cmd:
                    continue

                logger.info("[SSH-CFG] CONFIG CMD → %r", cmd)
                out = _send(cmd + "\n", pause=1.5)
                all_output += out
                logger.info("[SSH-CFG] After %r — raw: %r", cmd, out)

                if "% Invalid" in out or "% Incomplete" in out:
                    logger.error(
                        "[SSH-CFG] IOS rejected %r — output: %r", cmd, out
                    )
                    _send("end\n", pause=1.0)
                    return (
                        False,
                        all_output,
                        f"IOS rejected '{cmd}': {out.strip()}",
                    )

                in_config = any(ind in out for ind in config_indicators)
                if not in_config:
                    logger.warning(
                        "[SSH-CFG] Lost config mode after %r — output: %r",
                        cmd, out,
                    )
                    out2 = _read_all(1.5)
                    all_output += out2
                    logger.info(
                        "[SSH-CFG] Extra read after lost config — raw: %r",
                        out2,
                    )
                    in_config = any(ind in out2 for ind in config_indicators)
                    if not in_config:
                        _send("end\n", pause=1.0)
                        return (
                            False,
                            all_output,
                            f"Lost config mode after '{cmd}'. "
                            f"Got: {repr(out2[-300:])}",
                        )

            # ── Step 7: end ───────────────────────────────────────────
            logger.info("[SSH-CFG] → end")
            out = _send("end\n", pause=2.0)
            all_output += out
            logger.info("[SSH-CFG] After end — raw: %r", out)

            logger.info(
                "[SSH-CFG] ✓ Config session complete (%d commands).",
                len([c for c in commands if c.strip()]),
            )
            return True, all_output, ""

        except Exception as exc:
            msg = (
                f"[SSH-CFG] Unexpected error: {type(exc).__name__}: {exc}"
            )
            logger.error(msg, exc_info=True)
            return False, "", msg
        finally:
            client.close()

    # ═══════════════════════════════════════════════════════
    #  VLAN CHANGE
    # ═══════════════════════════════════════════════════════

    def change_vlan(
        self,
        port_label: str,
        new_vlan: str,
        vlan_type: str = "Access",
        description: str = "",
        timeout: int = 30,
    ) -> Tuple[bool, Optional[str], str, Optional[str]]:
        full_name = expand_interface_name(port_label)

        if vlan_type.lower() == "trunk":
            commands = [
                f"interface {full_name}",
                # Clean up access config before switching to trunk
                "no switchport access vlan",
                "no switchport mode access",
                # Now configure trunk
                "switchport mode trunk",
                f"switchport trunk allowed vlan {new_vlan}",
                "switchport trunk native vlan 1",
            ]
        else:
            commands = [
                f"interface {full_name}",
                # Clean up trunk config before switching to access
                "no switchport trunk allowed vlan",
                "no switchport trunk native vlan",
                "no switchport mode trunk",
                # Now configure access
                "switchport mode access",
                f"switchport access vlan {new_vlan}",
            ]
        if description:
            commands.append(f"description {description}")

        if self.switch.protocol_preference == "telnet":
            script = "conf t\n" + "\n".join(commands) + "\nend"
            ok, out, err = self.execute_telnet_command(
                script, enable=True, timeout=timeout
            )
            return ok, "telnet" if ok else None, out, err

        ok, out, err = self._ssh_config_commands(commands, timeout)
        if ok:
            return True, "ssh", out, err

        if self.switch.protocol_preference == "ssh":
            return False, None, out, err

        logger.info(
            "[STRATEGY] SSH config failed, trying Telnet fallback…"
        )
        script = "conf t\n" + "\n".join(commands) + "\nend"
        ok_t, out_t, err_t = self.execute_telnet_command(
            script, enable=True, timeout=timeout
        )
        if ok_t:
            return True, "telnet", out_t, err_t

        return False, None, "", f"SSH: {err} ; TELNET: {err_t}"

    # ═══════════════════════════════════════════════════════
    #  PORT ADMIN STATUS (shutdown / no shutdown)
    # ═══════════════════════════════════════════════════════

    def apply_port_status(
        self,
        port_label: str,
        port_status: str,
        timeout: int = 20,
    ) -> Tuple[bool, Optional[str], str, Optional[str]]:
        full_name = expand_interface_name(port_label)
        shutdown_cmd = (
            "shutdown" if port_status == "down" else "no shutdown"
        )

        commands = [
            f"interface {full_name}",
            shutdown_cmd,
        ]

        logger.info(
            "[PORT-STATUS] %s → %s (%s)",
            port_label, port_status, shutdown_cmd,
        )

        if self.switch.protocol_preference == "telnet":
            script = (
                f"conf t\n"
                f"interface {full_name}\n"
                f"{shutdown_cmd}\n"
                f"end"
            )
            ok, out, err = self.execute_telnet_command(
                script, enable=True, timeout=timeout
            )
            return ok, "telnet" if ok else None, out, err

        ok, out, err = self._ssh_config_commands(commands, timeout)
        if ok:
            return True, "ssh", out, err

        if self.switch.protocol_preference == "ssh":
            return False, None, out, err

        logger.info(
            "[STRATEGY] SSH failed for port status, trying Telnet…"
        )
        script = (
            f"conf t\n"
            f"interface {full_name}\n"
            f"{shutdown_cmd}\n"
            f"end"
        )
        ok_t, out_t, err_t = self.execute_telnet_command(
            script, enable=True, timeout=timeout
        )
        if ok_t:
            return True, "telnet", out_t, err_t

        return False, None, "", f"SSH: {err} ; TELNET: {err_t}"


# ═══════════════════════════════════════════════════════════════════
#  PERSISTENT TELNET SESSION
# ═══════════════════════════════════════════════════════════════════


class CiscoPersistentTelnet:
    def __init__(self, switch: CiscoSwitch, timeout: int = 30):
        self.switch = switch
        self.timeout = timeout
        self._tn: Optional[telnetlib.Telnet] = None
        self._connected = False

    @property
    def connected(self) -> bool:
        return self._connected

    def connect(self) -> Tuple[bool, str]:
        try:
            logger.info(
                "[TELNET-PERSIST] Ouverture session vers %s:%s …",
                self.switch.host, self.switch.telnet_port,
            )
            self._tn = telnetlib.Telnet(
                self.switch.host,
                self.switch.telnet_port,
                timeout=self.timeout,
            )
            idx, _, _ = self._tn.expect(
                [b"sername:", b"Username:", b"ogin:", b"Login:"],
                timeout=self.timeout,
            )
            if idx == -1:
                self._cleanup()
                return False, "[TELNET-PERSIST] Prompt login non détecté."

            self._tn.write(self.switch.username.encode("ascii") + b"\n")
            idx2, _, _ = self._tn.expect(
                [b"Password:", b"password:", b"assword:"],
                timeout=self.timeout,
            )
            if idx2 == -1:
                self._cleanup()
                return False, "[TELNET-PERSIST] Prompt password non détecté."

            self._tn.write(self.switch.password.encode("ascii") + b"\n")
            time.sleep(2.0)
            try:
                initial = self._tn.read_very_eager().decode(
                    "ascii", errors="ignore"
                )
                if (
                    "%" in initial
                    or "failed" in initial.lower()
                    or "invalid" in initial.lower()
                ):
                    self._cleanup()
                    return False, "[TELNET-PERSIST] Authentification échouée."
            except Exception:
                pass

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

    def close(self):
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

    def execute(
        self,
        command: str,
        idle_timeout: float = 3.0,
        post_send_delay: float = 1.0,
    ) -> Tuple[bool, str, str]:
        if not self._connected or not self._tn:
            return False, "", "[TELNET-PERSIST] Session non connectée."
        try:
            try:
                self._tn.read_very_eager()
            except Exception:
                pass

            logger.debug("[TELNET-PERSIST] >>> %r", command)
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
                        "[TELNET-PERSIST] Connexion fermée par le switch."
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
                len(buf), command,
            )
            return True, output, ""
        except Exception as e:
            self._connected = False
            msg = f"[TELNET-PERSIST] Erreur exécution : {e}"
            logger.exception(msg)
            return False, "", msg

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
        m = re.search(r"(?:Cisco IOS|IOS).+?Version\s+([\S]+)", output)
        if m:
            info["ios_version"] = m.group(1).rstrip(",")
    except Exception as e:
        logger.debug("Parse IOS version échoué: %s", e)
    try:
        m = re.search(r"[Pp]rocessor\s+board\s+ID\s+(\S+)", output)
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
    vlans: List[dict] = []
    try:
        for line in output.strip().split("\n"):
            m = re.match(
                r"(\d+)\s+(\S+)\s+(active|act/unsup|suspend)\s*(.*)",
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
    m = re.search(r"switchport access vlan (\d+)", output)
    if m:
        return "Access " + m.group(1)
    m = re.search(r"switchport trunk allowed (.+)", output)
    if m:
        return "Trunk " + m.group(1).strip()
    return None


def expand_interface_name(abbrev: str) -> str:
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
    parts = label.split("/")
    if parts:
        m = re.search(r"(\d+)$", parts[-1])
        if m:
            return int(m.group(1))
    return 0


def parse_interfaces_status(output: str) -> List[dict]:
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
    physical_prefixes = ("Gi", "Fa", "Te", "Tw", "Fo", "Hu", "Et")
    for line in output.strip().split("\n"):
        line = line.rstrip()
        if not line or line.startswith("Port") or line.startswith("-"):
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
                raw[i:i + 2].upper() for i in range(0, 12, 2)
            )
            mac_map[m.group(2)] = mac
    return mac_map


# ═══════════════════════════════════════════════════════════════════
#  HEALTH CHECK HELPER
# ═══════════════════════════════════════════════════════════════════


def test_connection_for_switch(
    switch: CiscoSwitch, timeout: int = 10
) -> Tuple[bool, Optional[str], str, int]:
    service = CiscoConnectionService(switch)
    start = time.time()
    ok, proto, msg = service.test_connection_preference(timeout=timeout)
    duration_ms = int((time.time() - start) * 1000)
    return ok, proto, msg, duration_ms