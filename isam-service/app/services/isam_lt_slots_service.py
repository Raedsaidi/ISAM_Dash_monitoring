import logging
import re
from typing import Tuple, Optional, List, Dict, Any

from app.services.isam_connection import ISAMConnectionService, Protocol
from app.models.isam_instance import ISAMInstance

logger = logging.getLogger(__name__)


class ISAMLTSlotsService:
    """
    Service pour récupérer les slots LT et leurs ports respectifs.
    """

    def __init__(self, instance: ISAMInstance):
        self.instance = instance
        self.conn_service = ISAMConnectionService(instance)

    # ---------- 1) Récupérer les slots LT ----------

    def get_lt_slots(self, timeout: int = 30) -> Tuple[bool, Optional[Protocol], str, List[Dict[str, Any]], str]:
        """
        Exécute: "show equipment slot | match exact:lt"
        
        Retourne:
            (success, protocol_used, raw_output, slots_list, message)
        """
        script = "show\nequipment\nslot | match exact:lt"

        try:
            success, protocol_used, raw_output, err_msg = self.conn_service.execute_command_preference(
                command=script,
                timeout=timeout,
            )

            if not success:
                logger.error(f"[LT_SLOTS] Impossible de récupérer les slots LT : {err_msg}")
                return False, protocol_used, raw_output or "", [], err_msg

            slots = self._parse_lt_slots(raw_output or "")
            logger.info(f"[LT_SLOTS] {len(slots)} slots LT récupérés et parsés.")
            return True, protocol_used, raw_output or "", slots, "OK"

        except Exception as e:
            msg = f"[LT_SLOTS] Erreur inattendue : {e}"
            logger.exception(msg)
            return False, None, "", [], msg

    @staticmethod
    def _parse_lt_slots(raw_output: str) -> List[Dict[str, Any]]:
        """
        Parse la sortie de: "show equipment slot | match exact:lt"
        
        Exemple de format:
        ```
        Ports on LT
        ====================================================================
        Port             Admin Link Port    Cfg  Oper LAG/ Port Port Port
        Id               State      State   MTU  MTU  Bndl Mode Encp Type
        --------------------------------------------------------------------
        lt:1/1/4         Up    No   Down    9212 9212    - accs dotq lt
        lt:1/1/5         Up    Yes  Up      9212 9212    - accs dotq lt
        lt:1/1/6         Up    Yes  Up      9212 9212    - accs dotq lt
        lt:1/1/7         Up    Yes  Up      9212 9212    - accs dotq lt
        lt:1/1/8         Up    Yes  Up      9212 9212    - accs dotq lt
        lt:1/1/9         Up    No   Down    9212 9212    - accs dotq lt
        lt:1/1/10        Up    Yes  Up      9212 9212    - accs dotq lt
        lt:1/1/11        Up    No   Down    9212 9212    - accs dotq lt
        ```
        """
        slots: List[Dict[str, Any]] = []
        current_board: str | None = None
        in_table: bool = False

        for line_orig in raw_output.splitlines():
            line = line_orig.rstrip("\n")
            stripped = line.strip()

            if not stripped:
                in_table = False
                continue

            # Détecte le board (ex: "Ports on LT")
            if stripped.startswith("Ports on "):
                current_board = stripped[len("Ports on "):].strip()
                in_table = False
                logger.debug(f"[LT_SLOTS] Détecté board: {current_board}")
                continue

            # Détecte l'en-tête du tableau
            if (
                stripped.lower().startswith("port")
                and "admin" in stripped.lower()
                and "link" in stripped.lower()
            ):
                in_table = True
                logger.debug("[LT_SLOTS] En-tête du tableau détecté")
                continue

            # Ignore les lignes de séparation
            if stripped.startswith("=") or stripped.startswith("-"):
                continue

            # Parse les lignes de données
            if in_table and current_board:
                parts = stripped.split()
                if len(parts) < 10:
                    logger.debug(f"[LT_SLOTS] Ligne non reconnue (trop courte) : {line_orig!r}")
                    continue

                slot_id = parts[0]
                admin_state = parts[1]
                link_state = parts[2]
                port_state = parts[3]
                cfg_mtu_str = parts[4]
                oper_mtu_str = parts[5]
                lag_bndl = parts[6]
                mode = parts[7]
                encap = parts[8]
                port_type = parts[9]

                # Parse les MTU
                try:
                    cfg_mtu = int(cfg_mtu_str)
                except ValueError:
                    cfg_mtu = 0
                try:
                    oper_mtu = int(oper_mtu_str)
                except ValueError:
                    oper_mtu = 0

                slot_dict = {
                    "slot_id": slot_id,
                    "board": current_board,
                    "admin_state": admin_state,
                    "link_state": link_state,
                    "port_state": port_state,
                    "cfg_mtu": cfg_mtu,
                    "oper_mtu": oper_mtu,
                    "lag_bndl": lag_bndl,
                    "mode": mode,
                    "encap": encap,
                    "port_type": port_type,
                }
                slots.append(slot_dict)
                logger.debug(f"[LT_SLOTS] Parsed slot: {slot_id} ({port_type})")

        return slots

    # ---------- 2) Récupérer les ports d'un slot LT ----------

    def get_slot_ports(
        self,
        slot_id: str,
        port_type: str,
        timeout: int = 30,
    ) -> Tuple[bool, Optional[Protocol], str, List[Dict[str, Any]], str]:
        """
        Récupère les ports individuels d'un slot LT.
        
        Selon le port_type, exécute la commande appropriée:
        - xdsl-line → "show interface port | match exact:{slot_id} | match exact:xdsl-line"
        - ethernet-line → "show interface port | match exact:{slot_id} | match exact:ethernet-line"
        - ont → "show interface port | match exact:{slot_id} | match exact:ont"
        
        Exemple de sortie:
        ```
        Ports on LT
        ====================================================================
        Port             Admin Link Port    Cfg  Oper LAG/ Port Port Port
        Id               State      State   MTU  MTU  Bndl Mode Encp Type
        --------------------------------------------------------------------
        1/1/5/1          Up    Yes  Up      9212 9212    - accs dotq xdsl-line
        1/1/5/2          Up    Yes  Up      9212 9212    - accs dotq xdsl-line
        1/1/5/3          Up    No   Down    9212 9212    - accs dotq xdsl-line
        ```
        """
        # Construire la commande
        script = f"show\ninterface\nport | match exact:{slot_id} | match exact:{port_type}"

        try:
            success, protocol_used, raw_output, err_msg = self.conn_service.execute_command_preference(
                command=script,
                timeout=timeout,
            )

            if not success:
                msg = f"[LT_PORTS] Impossible de récupérer les ports du slot {slot_id} ({port_type}): {err_msg}"
                logger.error(msg)
                return False, protocol_used, raw_output or "", [], err_msg

            ports = self._parse_slot_ports(raw_output or "", slot_id, port_type)
            logger.info(f"[LT_PORTS] {len(ports)} ports récupérés pour slot {slot_id}.")
            return True, protocol_used, raw_output or "", ports, "OK"

        except Exception as e:
            msg = f"[LT_PORTS] Erreur inattendue pour slot {slot_id} : {e}"
            logger.exception(msg)
            return False, None, "", [], msg

    @staticmethod
    def _parse_slot_ports(
        raw_output: str,
        slot_id: str,
        port_type: str,
    ) -> List[Dict[str, Any]]:
        """
        Parse les ports d'un slot spécifique.
        
        Format similaire aux slots, mais avec des port_id complets.
        """
        ports: List[Dict[str, Any]] = []
        current_board: str | None = None
        in_table: bool = False

        for line_orig in raw_output.splitlines():
            line = line_orig.rstrip("\n")
            stripped = line.strip()

            if not stripped:
                in_table = False
                continue

            # Détecte le board
            if stripped.startswith("Ports on "):
                current_board = stripped[len("Ports on "):].strip()
                in_table = False
                logger.debug(f"[LT_PORTS] Détecté board: {current_board}")
                continue

            # Détecte l'en-tête
            if (
                stripped.lower().startswith("port")
                and "admin" in stripped.lower()
                and "link" in stripped.lower()
            ):
                in_table = True
                continue

            # Ignore les séparations
            if stripped.startswith("=") or stripped.startswith("-"):
                continue

            # Parse les lignes
            if in_table and current_board:
                parts = stripped.split()
                if len(parts) < 10:
                    logger.debug(f"[LT_PORTS] Ligne non reconnue : {line_orig!r}")
                    continue

                port_id = parts[0]
                admin_state = parts[1]
                link_state = parts[2]
                port_state = parts[3]
                cfg_mtu_str = parts[4]
                oper_mtu_str = parts[5]
                lag_bndl = parts[6]
                mode = parts[7]
                encap = parts[8]
                port_type_actual = parts[9] if len(parts) > 9 else port_type

                try:
                    cfg_mtu = int(cfg_mtu_str)
                except ValueError:
                    cfg_mtu = 0
                try:
                    oper_mtu = int(oper_mtu_str)
                except ValueError:
                    oper_mtu = 0

                port_dict = {
                    "port_id": port_id,
                    "slot_id": slot_id,
                    "board": current_board,
                    "admin_state": admin_state,
                    "link_state": link_state,
                    "port_state": port_state,
                    "cfg_mtu": cfg_mtu,
                    "oper_mtu": oper_mtu,
                    "lag_bndl": lag_bndl,
                    "mode": mode,
                    "encap": encap,
                    "port_type": port_type_actual,
                }
                ports.append(port_dict)
                logger.debug(f"[LT_PORTS] Parsed port: {port_id}")

        return ports