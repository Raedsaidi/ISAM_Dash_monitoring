import logging
import re
from typing import Tuple, Optional, List, Dict, Any

from app.services.isam_connection import ISAMConnectionService, Protocol
from app.models.isam_instance import ISAMInstance

logger = logging.getLogger(__name__)

ALLOWED_PORT_TYPES = {"xdsl-line", "ethernet-line", "pon", "ont"}


class ISAMLTSlotsService:
    """
    Service pour récupérer les slots LT et leurs ports respectifs.
    """

    def __init__(self, instance: ISAMInstance):
        self.instance = instance
        self.conn_service = ISAMConnectionService(instance)

    # ---------- 1) Récupérer les slots LT ----------

    def get_lt_slots(
        self,
        timeout: int = 30,
    ) -> Tuple[bool, Optional[Protocol], str, List[Dict[str, Any]], str]:
        """
        Exécute: "show equipment slot | match exact:lt:"

        Retourne:
            (success, protocol_used, raw_output, slots_list, message)
        """
        # On colle à la commande réelle
        script = "show\nequipment\nslot | match exact:lt:"
        logger.info(
            "[LT_SLOTS] >>> Récupération des slots LT pour instance #%s (%s) avec script: %r",
            self.instance.id,
            self.instance.name,
            script,
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

            logger.info(
                "[LT_SLOTS] <<< Commande slots OK pour instance #%s via %s",
                self.instance.id,
                protocol_used,
            )

            if raw_output:
                logger.debug(
                    "[LT_SLOTS] Sortie brute (premières lignes):\n%s",
                    "\n".join(raw_output.splitlines()[:10]),
                )

            slots = self._parse_lt_slots(raw_output or "")
            logger.info(
                "[LT_SLOTS] %d slots LT parsés pour instance #%s.",
                len(slots),
                self.instance.id,
            )

            if not slots:
                msg = "Aucun slot LT parsé depuis 'show equipment slot | match exact:lt:'"
                logger.warning("[LT_SLOTS] %s", msg)
                return False, protocol_used, raw_output or "", [], msg

            return True, protocol_used, raw_output or "", slots, "OK"

        except Exception as e:
            msg = f"[LT_SLOTS] Erreur inattendue : {e}"
            logger.exception(msg)
            return False, None, "", [], msg

    @staticmethod
    def _parse_lt_slots(raw_output: str) -> List[Dict[str, Any]]:
        """
        Parse la sortie de: "show equipment slot | match exact:lt:"

        Format observé :

            leg:isadmin># show equipment slot | match exact:lt:
            lt:1/1/4   empty       no      no-error               not-installed 0
            lt:1/1/5   ndlt-c      yes     no-error               available     0
            lt:1/1/6   nelt-b      yes     no-error               available     0
            ...
            vlt:1/1/63 empty       no      no-error               not-installed 0
            vlt:1/1/64 empty       no      no-error               not-installed 0

        Colonnes (probables) :
            0: slot_id      (lt:1/1/5, vlt:1/1/63, ...)
            1: board_type   (ndlt-c, nglt-c, empty, ...)
            2: equipped     (yes/no)
            3: alarm_state  (no-error, no-installation, ...)
            4: admin_state  (available, not-installed, ...)
            5: power / misc (0)

        On NE RETIENT QUE les lignes "lt:" (on ignore vlt:).
        """
        slots: List[Dict[str, Any]] = []

        logger.info("[LT_SLOTS] Démarrage parsing des slots LT (on ignore vlt:)")

        for line_orig in raw_output.splitlines():
            line = line_orig.strip()
            if not line:
                continue

            # On ne garde que les vrais LT (on ignore les VLT, l'invite, etc.)
            if not line.startswith("lt:"):
                continue

            parts = line.split()
            if len(parts) < 5:
                logger.debug("[LT_SLOTS] Ligne slot non reconnue (trop courte) : %r", line_orig)
                continue

            raw_slot_id = parts[0]      # lt:1/1/5
            board_type = parts[1]       # ndlt-c / empty / ...
            equipped = parts[2]         # yes / no
            alarm_state = parts[3]      # no-error / no-installation / ...
            admin_state = parts[4]      # available / not-installed / ...

            # ID court sans préfixe lt: (ex: "1/1/5")
            if ":" in raw_slot_id:
                slot_short = raw_slot_id.split(":", 1)[1]
            else:
                slot_short = raw_slot_id

            # Tous les slots gardés ici sont de type LT
            port_type = "lt"

            # On n'a pas de MTU / LAG / mode / encap dans cette commande → valeurs par défaut
            slot_dict: Dict[str, Any] = {
                "slot_id": raw_slot_id,       # ex: "lt:1/1/5"
                "slot_short_id": slot_short,  # ex: "1/1/5" (pour show interface port)
                "board": board_type,          # ex: "ndlt-c", "empty", ...

                # Mapping sur le modèle "port"-like :
                "admin_state": admin_state,   # available / not-installed
                "link_state": equipped,       # yes / no (présence de la carte)
                "port_state": alarm_state,    # no-error / no-installation

                "cfg_mtu": 0,
                "oper_mtu": 0,
                "lag_bndl": "-",
                "mode": "-",
                "encap": "-",
                "port_type": port_type,       # "lt"
            }

            slots.append(slot_dict)
            logger.debug(
                "[LT_SLOTS] Slot parsé: %s (short=%s, board=%s, equipped=%s, admin=%s)",
                raw_slot_id,
                slot_short,
                board_type,
                equipped,
                admin_state,
            )

        logger.info("[LT_SLOTS] Fin parsing slots LT : %d slots parsés", len(slots))
        return slots

    # ---------- 2) Récupérer les ports d'un slot LT ----------

    def get_slot_ports(
        self,
        slot_id: str,        # ex: "lt:1/1/5" (id complet)
        slot_short_id: str,  # ex: "1/1/5" (id court utilisé dans la commande)
        timeout: int = 30,
    ) -> Tuple[bool, Optional[Protocol], str, List[Dict[str, Any]], str]:
        """
        Récupère tous les ports d'un slot LT avec:
        show interface port | match exact:{slot_short_id}

        On filtre ensuite pour ne garder que:
        - xdsl-line
        - ethernet-line
        - pon
        - ont
        """
        script = f"show\ninterface\nport | match exact:{slot_short_id}"

        logger.info(
            "[LT_PORTS] >>> Récupération des ports pour slot %s (short=%s) avec script: %r",
            slot_id,
            slot_short_id,
            script,
        )

        try:
            success, protocol_used, raw_output, err_msg = self.conn_service.execute_command_preference(
                command=script,
                timeout=timeout,
            )

            if not success:
                msg = (
                    f"[LT_PORTS] Impossible de récupérer les ports du slot "
                    f"{slot_id} (short={slot_short_id}) : {err_msg}"
                )
                logger.error(msg)
                return False, protocol_used, raw_output or "", [], err_msg

            logger.info(
                "[LT_PORTS] <<< Commande ports OK pour slot %s via %s",
                slot_id,
                protocol_used,
            )

            if raw_output:
                logger.debug(
                    "[LT_PORTS] Sortie brute pour slot %s (premières lignes):\n%s",
                    slot_id,
                    "\n".join(raw_output.splitlines()[:10]),
                )
            
            if raw_output is not None:
                logger.info(
                    "[LT_PORTS] RAW OUTPUT pour slot %s:\n%s",
                    slot_id,
                    raw_output,
                )

            ports = self._parse_slot_ports(raw_output or "", slot_id, slot_short_id)
            logger.info(
                "[LT_PORTS] %d ports (types %s) parsés pour slot %s",
                len(ports),
                ", ".join(sorted({p['port_type'] for p in ports}) or ["(aucun)"]),
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
        """
        Parse les ports d'un slot spécifique à partir de:

            show interface port | match exact:{slot_short_id}

        Format attendu par ligne:
            <type>:<id>    <admin_state>    <oper_state>

        Exemples:
            xdsl-line:1/1/5/1        down    down
            ethernet-line:1/1/5/1    up      no-value
            pon:1/1/7/1              up      up
            ont:1/1/7/1/1            up      down
        """
        ports: List[Dict[str, Any]] = []

        for line_orig in raw_output.splitlines():
            stripped = line_orig.strip()
            if not stripped:
                continue

            # On cherche des lignes du type  "<type>:<id>  <state>  <state>"
            m = re.match(r"^(\S+):(\S+)\s+(\S+)\s+(\S+)", stripped)
            if not m:
                logger.debug("[LT_PORTS] Ligne ignorée (ne matche pas le pattern) : %r", line_orig)
                continue

            port_type = m.group(1)  # xdsl-line / ethernet-line / pon / ont / ...
            port_id = m.group(2)    # 1/1/5/1, 1/1/7/1, 1/1/7/1/1, ...
            admin_state = m.group(3)
            oper_state = m.group(4)

            if port_type not in ALLOWED_PORT_TYPES:
                logger.debug(
                    "[LT_PORTS] Type de port ignoré pour slot %s : %s",
                    slot_id,
                    port_type,
                )
                continue

            # On ne dispose pas d'info MTU/lag/mode/encap dans cette commande,
            # on met des valeurs par défaut.
            port_dict: Dict[str, Any] = {
                "port_id": port_id,
                "slot_id": slot_id,        # "lt:1/1/5"
                "port_type": port_type,
                "admin_state": admin_state,
                "link_state": oper_state,  # on mappe oper_state sur link_state
                "port_state": oper_state,  # pour compatibilité avec le modèle
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
            logger.debug(
                "[LT_PORTS] Port parsé pour slot %s: type=%s, id=%s, admin=%s, oper=%s",
                slot_id,
                port_type,
                port_id,
                admin_state,
                oper_state,
            )

        return ports