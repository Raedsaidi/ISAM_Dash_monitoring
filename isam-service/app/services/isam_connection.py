import logging
import socket
import time
import subprocess
from typing import Tuple, Literal, Optional

import paramiko
import telnetlib

from app.models.isam_instance import ISAMInstance

logger = logging.getLogger(__name__)

Protocol = Literal["ssh", "telnet"]


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

        try:
            logger.info(
                f"[SSH] Test connexion à {self.instance.host}:{self.instance.ssh_port}..."
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
            msg = "[SSH] Connexion réussie."
            logger.info(msg)
            return True, msg

        except (socket.timeout, paramiko.ssh_exception.NoValidConnectionsError) as e:
            msg = f"[SSH] Impossible de se connecter : {e}"
            logger.error(msg)
            return False, msg
        except paramiko.AuthenticationException:
            msg = "[SSH] Erreur d'authentification."
            logger.error(msg)
            return False, msg
        except Exception as e:
            msg = f"[SSH] Erreur inattendue : {e}"
            logger.exception(msg)
            return False, msg
        finally:
            client.close()

    def test_ssh_connection_legacy(self, timeout: int = 10) -> Tuple[bool, str]:
        """Test SSH avec algorithmes legacy (ssh-rsa)"""
        try:
            logger.info(
                f"[SSH-LEGACY] Test connexion à {self.instance.host}:{self.instance.ssh_port} "
                f"avec algorithmes legacy..."
            )
            
            # Utiliser ssh via subprocess avec les options d'algorithmes legacy
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
            
            if result.returncode == 0:
                msg = "[SSH-LEGACY] Connexion réussie avec algorithmes legacy."
                logger.info(msg)
                return True, msg
            else:
                msg = f"[SSH-LEGACY] Connexion échouée: {result.stderr.decode('utf-8', errors='ignore')}"
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

    def test_telnet_connection(self, timeout: int = 10) -> Tuple[bool, str]:
        try:
            logger.info(
                f"[TELNET] Test connexion à {self.instance.host}:{self.instance.telnet_port}..."
            )
            with telnetlib.Telnet(
                self.instance.host, self.instance.telnet_port, timeout=timeout
            ) as tn:
                tn.read_until(b"login: ", timeout=timeout)
                tn.write(self.instance.username.encode("ascii") + b"\n")

                tn.read_until(b"Password: ", timeout=timeout)
                tn.write(self.instance.password.encode("ascii") + b"\n")

                time.sleep(1)
                output = tn.read_very_eager().decode("ascii", errors="ignore")

                if "#" in output or ">" in output:
                    msg = "[TELNET] Connexion réussie, prompt détecté."
                    logger.info(msg)
                    return True, msg
                else:
                    msg = "[TELNET] Connexion établie mais prompt non reconnu."
                    logger.warning(msg + f" Output: {repr(output)}")
                    return False, msg

        except (socket.timeout, ConnectionRefusedError) as e:
            msg = f"[TELNET] Impossible de se connecter (timeout/refus) : {e}"
            logger.error(msg)
            return False, msg
        except Exception as e:
            msg = f"[TELNET] Erreur inattendue : {e}"
            logger.exception(msg)
            return False, msg

    # ----------- EXÉCUTION DE COMMANDES -----------

    def execute_ssh_command(
        self, command: str, timeout: int = 20
    ) -> Tuple[bool, str, str]:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        try:
            logger.info(f"[SSH] Exécution commande: {command!r}")
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

            logger.info(f"[SSH] Commande exécutée, code retour: {exit_status}")
            if exit_status == 0:
                return True, out, err
            else:
                msg = f"Commande SSH retournée avec code {exit_status}"
                logger.warning(msg)
                return False, out, err or msg

        except Exception as e:
            msg = f"[SSH] Erreur lors de l'exécution de la commande : {e}"
            logger.exception(msg)
            return False, "", msg
        finally:
            client.close()

    def execute_ssh_command_legacy(
        self, command: str, timeout: int = 20
    ) -> Tuple[bool, str, str]:
        """Exécute une commande SSH avec algorithmes legacy"""
        try:
            logger.info(f"[SSH-LEGACY] Exécution commande: {command!r}")
            
            cmd = [
                "ssh",
                "-o", "HostKeyAlgorithms=+ssh-rsa",
                "-o", "PubkeyAcceptedAlgorithms=+ssh-rsa",
                "-o", "StrictHostKeyChecking=no",
                "-o", f"ConnectTimeout={timeout}",
                f"{self.instance.username}@{self.instance.host}",
                "-p", str(self.instance.ssh_port),
                command
            ]
            
            result = subprocess.run(
                cmd,
                input=f"{self.instance.password}\n".encode(),
                capture_output=True,
                timeout=timeout + 5,
            )
            
            out = result.stdout.decode("utf-8", errors="ignore")
            err = result.stderr.decode("utf-8", errors="ignore")
            
            if result.returncode == 0:
                logger.info(f"[SSH-LEGACY] Commande exécutée avec succès")
                return True, out, err
            else:
                logger.warning(f"[SSH-LEGACY] Commande retournée code {result.returncode}")
                return False, out, err

        except subprocess.TimeoutExpired:
            msg = "[SSH-LEGACY] Timeout lors de l'exécution de la commande."
            logger.error(msg)
            return False, "", msg
        except Exception as e:
            msg = f"[SSH-LEGACY] Erreur lors de l'exécution de la commande : {e}"
            logger.exception(msg)
            return False, "", msg

    def execute_telnet_command(
        self, command: str, timeout: int = 20, idle_timeout: float = 1.0
    ) -> Tuple[bool, str, str]:
        """
        Exécute une commande via Telnet en lisant la sortie jusqu'à ce qu'il
        n'y ait plus de données pendant idle_timeout secondes, ou qu'on dépasse
        timeout au total.
        """
        try:
            logger.info(f"[TELNET] Exécution commande: {command!r}")
            with telnetlib.Telnet(
                self.instance.host, self.instance.telnet_port, timeout=timeout
            ) as tn:
                # --- Login ---
                tn.read_until(b"login: ", timeout=timeout)
                tn.write(self.instance.username.encode("ascii") + b"\n")

                tn.read_until(b"Password: ", timeout=timeout)
                tn.write(self.instance.password.encode("ascii") + b"\n")

                # On laisse le prompt arriver puis on vide le buffer
                time.sleep(1)
                tn.read_very_eager()

                # --- Envoi de la commande ---
                # Support des commandes multi-lignes type "show\ninterface\nport ..."
                for line in command.split("\n"):
                    line = line.strip()
                    if not line:
                        continue
                    tn.write(line.encode("ascii") + b"\n")
                    # petit délai pour laisser le CLI changer de contexte
                    time.sleep(0.2)

                # --- Lecture de la sortie ---
                end_time = time.time() + timeout
                last_data_time = time.time()
                buffer = b""

                while time.time() < end_time:
                    chunk = tn.read_very_eager()
                    if chunk:
                        buffer += chunk
                        last_data_time = time.time()
                    else:
                        # Rien de nouveau : si on a déjà reçu des données
                        # et qu'il n'y a plus rien depuis idle_timeout, on arrête.
                        if buffer and (time.time() - last_data_time) > idle_timeout:
                            break
                        # Petit sleep pour éviter de tourner à vide
                        time.sleep(0.2)

                output = buffer.decode("ascii", errors="ignore")
                logger.info("[TELNET] Commande exécutée.")
                return True, output, ""

        except Exception as e:
            msg = f"[TELNET] Erreur lors de l'exécution de la commande : {e}"
            logger.exception(msg)
            return False, "", msg

    # ----------- TESTS AVEC STRATÉGIES -----------

    def test_connection_preference(
        self, timeout: int = 10
    ) -> Tuple[bool, Optional[Protocol], str]:
        """
        Tente le protocole selon protocol_preference :
        - 'ssh' : SSH standard → SSH legacy → Telnet
        - 'telnet' : seulement Telnet
        - 'auto' : SSH standard → SSH legacy → Telnet
        """
        if self.instance.protocol_preference == "telnet":
            ok, msg = self.test_telnet_connection(timeout=timeout)
            return ok, "telnet" if ok else None, msg

        # SSH (standard ou auto) : essayer SSH normal → SSH legacy → Telnet
        ssh_ok, ssh_msg = self.test_ssh_connection(timeout=timeout)
        if ssh_ok:
            return True, "ssh", ssh_msg
        
        # SSH standard échoué, essayer SSH legacy
        logger.info("[STRATEGY] SSH standard échoué, tentative SSH legacy...")
        ssh_legacy_ok, ssh_legacy_msg = self.test_ssh_connection_legacy(timeout=timeout)
        if ssh_legacy_ok:
            return True, "ssh-legacy", ssh_legacy_msg
        
        # SSH échoué (standard et legacy)
        if self.instance.protocol_preference == "ssh":
            # Mode SSH uniquement : retourner l'erreur
            return False, None, f"SSH: {ssh_msg} ; SSH-LEGACY: {ssh_legacy_msg}"
        
        # Mode "auto" : essayer Telnet
        logger.info("[STRATEGY] SSH échoué, tentative Telnet...")
        telnet_ok, telnet_msg = self.test_telnet_connection(timeout=timeout)
        if telnet_ok:
            return True, "telnet", telnet_msg

        return False, None, f"SSH: {ssh_msg} ; SSH-LEGACY: {ssh_legacy_msg} ; TELNET: {telnet_msg}"

    def execute_command_preference(
        self, command: str, timeout: int = 20
    ) -> Tuple[bool, Optional[Protocol], str, str]:
        """
        Exécute une commande selon protocol_preference ('ssh','telnet','auto').
        SSH standard → SSH legacy → Telnet
        """
        if self.instance.protocol_preference == "telnet":
            ok, out, err = self.execute_telnet_command(command, timeout=timeout)
            return ok, "telnet" if ok else None, out, err

        # SSH (standard ou auto) : essayer SSH normal → SSH legacy → Telnet
        ok, out, err = self.execute_ssh_command(command, timeout=timeout)
        if ok:
            return True, "ssh", out, err
        
        # SSH standard échoué, essayer SSH legacy
        logger.info("[STRATEGY] SSH standard échoué, tentative SSH legacy...")
        ok_legacy, out_legacy, err_legacy = self.execute_ssh_command_legacy(
            command, timeout=timeout
        )
        if ok_legacy:
            return True, "ssh-legacy", out_legacy, err_legacy
        
        # SSH échoué (standard et legacy)
        if self.instance.protocol_preference == "ssh":
            # Mode SSH uniquement : retourner l'erreur
            return False, None, out, f"SSH: {err} ; SSH-LEGACY: {err_legacy}"
        
        # Mode "auto" : essayer Telnet
        logger.info("[STRATEGY] SSH échoué, tentative Telnet...")
        ok_tel, out_tel, msg_tel = self.execute_telnet_command(
            command, timeout=timeout
        )
        if ok_tel:
            return True, "telnet", out_tel, msg_tel

        return False, None, "", f"SSH: {err} ; SSH-LEGACY: {err_legacy} ; TELNET: {msg_tel}"


def test_connection_for_instance(instance: ISAMInstance, timeout: int = 10):
    """
    Helper pour les health-checks.
    Retourne (success, protocol_used, message, response_time_ms)
    """
    import time as _time
    service = ISAMConnectionService(instance)
    start = _time.time()
    ok, proto, msg = service.test_connection_preference(timeout=timeout)
    duration_ms = int((_time.time() - start) * 1000)
    return ok, proto, msg, duration_ms