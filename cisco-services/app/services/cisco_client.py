# app/services/cisco_client.py

"""
Cisco device client — SSH (paramiko) + Telnet (telnetlib).
"""

import logging
import re
import socket
import time
import telnetlib
from typing import List, Literal, Optional, Tuple

import paramiko

from app.core.config import settings
from app.models.cisco_switch import CiscoSwitch

logger = logging.getLogger(__name__)

Protocol = Literal["ssh", "telnet"]


class CiscoConnectionService:
    """
    Handles SSH and Telnet connections to a Cisco switch/router.
    """

    def __init__(self, switch: CiscoSwitch):
        self.switch = switch
        self.connect_timeout = settings.CISCO_CONNECTION_TIMEOUT
        self.command_timeout = settings.CISCO_COMMAND_TIMEOUT

    # ──────────────────────────────────────────────────
    #  SSH — Test Connection
    # ──────────────────────────────────────────────────

    def test_ssh_connection(self, timeout: int = 10) -> Tuple[bool, str]:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        try:
            logger.info(
                "[SSH] Testing connection to %s:%s...",
                self.switch.host,
                self.switch.ssh_port,
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
                f"[SSH] Connection successful to "
                f"{self.switch.host}:{self.switch.ssh_port}."
            )
            logger.info(msg)
            return True, msg

        except paramiko.AuthenticationException:
            msg = (
                f"[SSH] Authentication failed for {self.switch.username}@"
                f"{self.switch.host}:{self.switch.ssh_port} "
                f"— wrong username or password."
            )
            logger.error(msg)
            return False, msg

        except paramiko.SSHException as e:
            msg = (
                f"[SSH] Protocol error connecting to "
                f"{self.switch.host}:{self.switch.ssh_port} — {str(e)}"
            )
            logger.error(msg)
            return False, msg

        except socket.timeout:
            msg = (
                f"[SSH] Connection timed out to "
                f"{self.switch.host}:{self.switch.ssh_port} "
                f"(timeout={timeout}s)."
            )
            logger.error(msg)
            return False, msg

        except socket.gaierror as e:
            msg = (
                f"[SSH] DNS resolution failed for host "
                f"'{self.switch.host}' — {str(e)}"
            )
            logger.error(msg)
            return False, msg

        except ConnectionRefusedError:
            msg = (
                f"[SSH] Connection refused by "
                f"{self.switch.host}:{self.switch.ssh_port} "
                f"— is SSH enabled on the device?"
            )
            logger.error(msg)
            return False, msg

        except OSError as e:
            msg = (
                f"[SSH] Network error connecting to "
                f"{self.switch.host}:{self.switch.ssh_port} — {str(e)}"
            )
            logger.error(msg)
            return False, msg

        except Exception as e:
            msg = (
                f"[SSH] Unexpected error connecting to "
                f"{self.switch.host}:{self.switch.ssh_port} — "
                f"{type(e).__name__}: {str(e)}"
            )
            logger.exception(msg)
            return False, msg

        finally:
            client.close()

    # ──────────────────────────────────────────────────
    #  Telnet — Test Connection
    # ──────────────────────────────────────────────────

    def test_telnet_connection(self, timeout: int = 10) -> Tuple[bool, str]:
        try:
            logger.info(
                "[TELNET] Testing connection to %s:%s...",
                self.switch.host,
                self.switch.telnet_port,
            )
            with telnetlib.Telnet(
                self.switch.host, self.switch.telnet_port, timeout=timeout
            ) as tn:
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
                    result = tn.read_very_eager().decode(
                        "utf-8", errors="replace"
                    )

                    if (
                        "%" in result
                        or "failed" in result.lower()
                        or "invalid" in result.lower()
                    ):
                        msg = (
                            f"[TELNET] Authentication failed for "
                            f"{self.switch.username}@"
                            f"{self.switch.host}:{self.switch.telnet_port}."
                        )
                        logger.error(msg)
                        return False, msg

                msg = (
                    f"[TELNET] Connection successful to "
                    f"{self.switch.host}:{self.switch.telnet_port}."
                )
                logger.info(msg)
                return True, msg

        except socket.timeout:
            msg = (
                f"[TELNET] Connection timed out to "
                f"{self.switch.host}:{self.switch.telnet_port} "
                f"(timeout={timeout}s)."
            )
            logger.error(msg)
            return False, msg

        except ConnectionRefusedError:
            msg = (
                f"[TELNET] Connection refused by "
                f"{self.switch.host}:{self.switch.telnet_port} "
                f"— is Telnet enabled on the device?"
            )
            logger.error(msg)
            return False, msg

        except socket.gaierror as e:
            msg = (
                f"[TELNET] DNS resolution failed for host "
                f"'{self.switch.host}' — {str(e)}"
            )
            logger.error(msg)
            return False, msg

        except OSError as e:
            msg = (
                f"[TELNET] Network error connecting to "
                f"{self.switch.host}:{self.switch.telnet_port} — {str(e)}"
            )
            logger.error(msg)
            return False, msg

        except Exception as e:
            msg = (
                f"[TELNET] Unexpected error connecting to "
                f"{self.switch.host}:{self.switch.telnet_port} — "
                f"{type(e).__name__}: {str(e)}"
            )
            logger.exception(msg)
            return False, msg

    # ──────────────────────────────────────────────────
    #  SSH — Execute Command (interactive shell)
    # ──────────────────────────────────────────────────

    def execute_ssh_command(
        self, command: str, enable: bool = False, timeout: int = 20
    ) -> Tuple[bool, str, str]:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        try:
            logger.info("[SSH] Executing command: %r", command)
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
                                    "Enable password rejected by device.",
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
                "[SSH] Command executed, output length: %d", len(decoded)
            )
            return True, decoded, ""

        except socket.timeout:
            msg = (
                f"[SSH] Command timed out after {timeout}s: '{command}'"
            )
            logger.error(msg)
            return False, "", msg

        except paramiko.AuthenticationException:
            msg = (
                f"[SSH] Authentication failed for "
                f"{self.switch.username}@{self.switch.host}"
            )
            logger.error(msg)
            return False, "", msg

        except paramiko.SSHException as e:
            msg = (
                f"[SSH] Protocol error executing '{command}': {str(e)}"
            )
            logger.error(msg)
            return False, "", msg

        except Exception as e:
            msg = (
                f"[SSH] Unexpected error executing '{command}': "
                f"{type(e).__name__}: {str(e)}"
            )
            logger.exception(msg)
            return False, "", msg

        finally:
            client.close()

    # ──────────────────────────────────────────────────
    #  Telnet — Execute Command
    # ──────────────────────────────────────────────────

    def execute_telnet_command(
        self,
        command: str,
        enable: bool = False,
        timeout: int = 20,
        idle_timeout: float = 2.0,
    ) -> Tuple[bool, str, str]:
        try:
            logger.info("[TELNET] Executing command: %r", command)
            with telnetlib.Telnet(
                self.switch.host, self.switch.telnet_port, timeout=timeout
            ) as tn:
                tn.expect([b"sername:", b"ogin:"], timeout=timeout)
                tn.write(
                    self.switch.username.encode("ascii") + b"\n"
                )
                tn.expect([b"assword:"], timeout=timeout)
                tn.write(
                    self.switch.password.encode("ascii") + b"\n"
                )

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
                                "Enable password rejected by device.",
                            )

                tn.write(b"terminal length 0\n")
                time.sleep(1)
                tn.read_very_eager()

                tn.write(command.encode("ascii") + b"\n")
                time.sleep(3)

                end_time = time.time() + timeout
                last_data_time = time.time()
                buf = b""

                while time.time() < end_time:
                    chunk = tn.read_very_eager()
                    if chunk:
                        buf += chunk
                        last_data_time = time.time()
                    else:
                        if buf and (
                            time.time() - last_data_time
                        ) > idle_timeout:
                            break
                        time.sleep(0.2)

                output = buf.decode("utf-8", errors="replace")
                logger.info(
                    "[TELNET] Command executed, output length: %d",
                    len(output),
                )
                return True, output, ""

        except socket.timeout:
            msg = f"[TELNET] Command timed out: '{command}'"
            logger.error(msg)
            return False, "", msg

        except EOFError as e:
            msg = (
                f"[TELNET] Connection closed during '{command}': "
                f"{str(e)}"
            )
            logger.error(msg)
            return False, "", msg

        except ConnectionRefusedError:
            msg = (
                f"[TELNET] Connection refused by "
                f"{self.switch.host}:{self.switch.telnet_port}"
            )
            logger.error(msg)
            return False, "", msg

        except Exception as e:
            msg = (
                f"[TELNET] Error executing '{command}': "
                f"{type(e).__name__}: {str(e)}"
            )
            logger.exception(msg)
            return False, "", msg

    # ──────────────────────────────────────────────────
    #  Strategy — test connection with fallback
    # ──────────────────────────────────────────────────

    def test_connection_preference(
        self, timeout: int = 10
    ) -> Tuple[bool, Optional[Protocol], str]:
        if self.switch.protocol_preference == "telnet":
            ok, msg = self.test_telnet_connection(timeout=timeout)
            return ok, "telnet" if ok else None, msg

        ssh_ok, ssh_msg = self.test_ssh_connection(timeout=timeout)
        if ssh_ok:
            return True, "ssh", ssh_msg

        if self.switch.protocol_preference == "ssh":
            return False, None, ssh_msg

        logger.info("[STRATEGY] SSH failed, trying Telnet...")
        telnet_ok, telnet_msg = self.test_telnet_connection(timeout=timeout)
        if telnet_ok:
            return True, "telnet", telnet_msg

        return False, None, f"SSH: {ssh_msg} | TELNET: {telnet_msg}"

    # ──────────────────────────────────────────────────
    #  Strategy — execute command with fallback
    # ──────────────────────────────────────────────────

    def execute_command_preference(
        self,
        command: str,
        enable: bool = False,
        timeout: int = 20,
    ) -> Tuple[bool, Optional[Protocol], str, str]:
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

        if self.switch.protocol_preference == "ssh":
            return False, None, out, err

        logger.info("[STRATEGY] SSH command failed, trying Telnet...")
        ok_tel, out_tel, err_tel = self.execute_telnet_command(
            command, enable=enable, timeout=timeout
        )
        if ok_tel:
            return True, "telnet", out_tel, err_tel

        return False, None, "", f"SSH: {err} | TELNET: {err_tel}"

    # ──────────────────────────────────────────────────
    #  Port Status (show interfaces status)
    # ──────────────────────────────────────────────────

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

        try:
            mac_ok, _, mac_out, _ = self.execute_command_preference(
                "show mac address-table", timeout=15
            )
            if mac_ok and mac_out:
                mac_map = parse_mac_table(mac_out)
                for p in ports:
                    p["mac_address"] = mac_map.get(p["port_label"])
        except Exception as e:
            logger.debug("MAC table fetch skipped: %s", e)

        return True, proto, ports, None

    # ──────────────────────────────────────────────────
    #  Port Config
    # ──────────────────────────────────────────────────

    def get_port_running_config(
        self, port_label: str, timeout: int = 15
    ) -> Tuple[bool, Optional[str], str, Optional[str]]:
        """Returns (success, protocol_used, output, error)."""
        full_name = expand_interface_name(port_label)
        cmd = f"show running-config interface {full_name}"
        return self.execute_command_preference(cmd, timeout=timeout)

    # ──────────────────────────────────────────────────
    #  VLAN Change (config mode)
    # ──────────────────────────────────────────────────

    def change_vlan(
        self,
        port_label: str,
        new_vlan: str,
        vlan_type: str = "Access",
        description: str = "",
        timeout: int = 30,
    ) -> Tuple[bool, Optional[str], str, Optional[str]]:
        """
        Change VLAN on a port.
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

        if self.switch.protocol_preference == "telnet":
            ok, out, err = self.execute_telnet_command(
                script, timeout=timeout
            )
            return ok, "telnet" if ok else None, out, err

        ok, out, err = self._ssh_config_commands(commands, timeout)
        if ok:
            return True, "ssh", out, err

        if self.switch.protocol_preference == "ssh":
            return False, None, out, err

        logger.info("[STRATEGY] SSH config failed, trying Telnet...")
        ok_t, out_t, err_t = self.execute_telnet_command(
            script, timeout=timeout
        )
        if ok_t:
            return True, "telnet", out_t, err_t

        return False, None, "", f"SSH: {err} | TELNET: {err_t}"

    def _ssh_config_commands(
        self, commands: List[str], timeout: int = 30
    ) -> Tuple[bool, str, str]:
        """Send multiple config commands via SSH interactive shell."""
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

            shell.send("terminal length 0\n")
            time.sleep(0.5)
            if shell.recv_ready():
                shell.recv(65535)

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
                    "Device returned an error in command output.",
                )

            return True, decoded, ""

        except Exception as e:
            msg = (
                f"[SSH-CONFIG] Error: "
                f"{type(e).__name__}: {str(e)}"
            )
            logger.error(msg)
            return False, "", msg
        finally:
            client.close()


# ──────────────────────────────────────────────────
#  Parsers
# ──────────────────────────────────────────────────


def parse_show_version(output: str) -> dict:
    """Parse 'show version' into structured data."""
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
        logger.debug("Parse hostname failed: %s", e)

    try:
        m = re.search(
            r"[Cc]isco\s+([\w\-]+).*(?:processor|bytes of memory)",
            output,
        )
        if m:
            info["model"] = m.group(1)
    except Exception as e:
        logger.debug("Parse model failed: %s", e)

    try:
        m = re.search(
            r"(?:Cisco IOS|IOS).+?Version\s+([\S]+)", output
        )
        if m:
            info["ios_version"] = m.group(1).rstrip(",")
    except Exception as e:
        logger.debug("Parse IOS version failed: %s", e)

    try:
        m = re.search(r"[Pp]rocessor\s+board\s+ID\s+(\S+)", output)
        if m:
            info["serial_number"] = m.group(1)
    except Exception as e:
        logger.debug("Parse serial failed: %s", e)

    try:
        m = re.search(r"uptime is\s+(.+)", output)
        if m:
            info["uptime"] = m.group(1).strip()
    except Exception as e:
        logger.debug("Parse uptime failed: %s", e)

    return info


def parse_interfaces(output: str) -> List[dict]:
    """Parse 'show ip interface brief' output."""
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
        logger.warning("Failed to parse interfaces: %s", e)

    return interfaces


def parse_vlans(output: str) -> List[dict]:
    """Parse 'show vlan brief' output."""
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
        logger.warning("Failed to parse VLANs: %s", e)

    return vlans


# ──────────────────────────────────────────────────
#  Helper for health checks
# ──────────────────────────────────────────────────


def test_connection_for_switch(
    switch: CiscoSwitch, timeout: int = 10
) -> Tuple[bool, Optional[str], str, int]:
    """
    Returns (success, protocol_used, message, response_time_ms).
    """
    service = CiscoConnectionService(switch)
    start = time.time()
    ok, proto, msg = service.test_connection_preference(timeout=timeout)
    duration_ms = int((time.time() - start) * 1000)
    return ok, proto, msg, duration_ms


def parse_running_config_vlan(output: str) -> Optional[str]:
    """Extract current VLAN from show running-config interface output."""
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
    """Parse 'show interfaces status' output."""
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
    """Parse 'show mac address-table' → {port_label: mac}."""
    mac_map: dict = {}
    for line in output.strip().split("\n"):
        m = re.match(
            r"\s*\d+\s+"
            r"([0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4})\s+"
            r"\S+\s+"
            r"(\S+)",
            line.strip(),
        )
        if m:
            raw = m.group(1).replace(".", "")
            mac = ":".join(
                raw[i : i + 2].upper() for i in range(0, 12, 2)
            )
            mac_map[m.group(2)] = mac
    return mac_map