import logging
import re
import time
from typing import Tuple, Optional, List, Dict, Any

from app.services.isam_connection import ISAMConnectionService, ISAMPersistentTelnet, Protocol
from app.models.isam_instance import ISAMInstance

logger = logging.getLogger(__name__)

ALLOWED_PORT_TYPES = {"xdsl-line", "ethernet-line", "pon", "ont"}


class ISAMLTSlotsService:
    """
    Service pour récupérer les slots LT et leurs ports respectifs.

    STRATÉGIE v3 — UNE SEULE COMMANDE PORT :
    Au lieu d'envoyer N commandes "show interface port | match exact:X"
    (une par slot), on envoie UNE SEULE commande globale :
        show interface port
    puis on parse toutes les lignes et on répartit chaque port dans
    le bon slot grâce à son port_id.

    Cela élimine complètement le problème de décalage du buffer Telnet.
    """

    def __init__(self, instance: ISAMInstance):
        self.instance = instance
        self.conn_service = ISAMConnectionService(instance)

    # ================================================================
    # ===============  MÉTHODES UTILITAIRES  ===========================
    # ================================================================

    @staticmethod
    def _port_belongs_to_slot(port_id: str, slot_short_id: str) -> bool:
        """
        Vérifie qu'un port_id appartient au slot slot_short_id.
        Le "/" final empêche "1/1/7" de matcher "1/1/70".
        """
        expected_prefix = slot_short_id + "/"
        return port_id.startswith(expected_prefix)

    @staticmethod
    def _extract_slot_from_port_id(port_id: str, known_slot_short_ids: List[str]) -> Optional[str]:
        """
        Détermine à quel slot un port_id appartient.
        Tri par longueur décroissante pour matcher "1/1/10" avant "1/1/1".
        """
        sorted_slots = sorted(known_slot_short_ids, key=len, reverse=True)
        for slot_short in sorted_slots:
            if port_id.startswith(slot_short + "/"):
                return slot_short
        return None

    # ================================================================
    # =========  1) Récupérer les slots LT (connexion individuelle)  ==
    # ================================================================

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
        """
        Parse la sortie de: "show equipment slot | match exact:lt:"
        On NE RETIENT QUE les lignes "lt:" (on ignore vlt:).
        """
        slots: List[Dict[str, Any]] = []

        logger.info("[LT_SLOTS] Démarrage parsing des slots LT (on ignore vlt:)")

        for line_orig in raw_output.splitlines():
            line = line_orig.strip()
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

    # ================================================================
    # ===  2) Récupérer les ports d'un slot (connexion individuelle)  =
    # ================================================================

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
        """
        Parse les ports d'un slot avec filtrage strict par slot_short_id.
        Accepte les lignes avec 2 ou 3+ colonnes après le type:id.
        """
        ports: List[Dict[str, Any]] = []
        skipped_wrong_slot = 0
        skipped_wrong_type = 0

        for line_orig in raw_output.splitlines():
            stripped = line_orig.strip()
            if not stripped:
                continue

            # Accepter 2 ou 3+ colonnes : type:id admin [oper]
            m = re.match(r"^(\S+):(\S+)\s+(\S+)(?:\s+(\S+))?", stripped)
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

        return ports

    # ================================================================
    # ===  3) PARSING GLOBAL — UNE SEULE PASSE SUR TOUT LE BUFFER  ===
    # ================================================================

    @staticmethod
    def _parse_all_ports_from_buffer(
        raw_buffer: str,
        known_slot_short_ids: List[str],
    ) -> Dict[str, List[Dict[str, Any]]]:
        """
        Parse TOUTES les lignes de port du buffer et répartit chaque port
        dans le bon slot en se basant sur le port_id.

        Accepte les lignes avec 2 ou 3 colonnes après type:id.
        Gère le dédoublonnage.
        """
        ports_by_slot: Dict[str, List[Dict[str, Any]]] = {}
        for slot_short in known_slot_short_ids:
            ports_by_slot[slot_short] = []

        seen_full_ids: set = set()
        unmatched_count = 0
        skipped_type_count = 0
        total_parsed_lines = 0

        for line_orig in raw_buffer.splitlines():
            stripped = line_orig.strip()
            if not stripped:
                continue

            # Accepter 2 ou 3+ colonnes
            m = re.match(r"^(\S+):(\S+)\s+(\S+)(?:\s+(\S+))?", stripped)
            if not m:
                continue

            port_type = m.group(1)
            port_id = m.group(2)
            admin_state = m.group(3)
            oper_state = m.group(4) if m.group(4) else admin_state

            total_parsed_lines += 1

            # Filtrage par type
            if port_type not in ALLOWED_PORT_TYPES:
                skipped_type_count += 1
                continue

            # Dédoublonnage
            full_id = f"{port_type}:{port_id}"
            if full_id in seen_full_ids:
                continue
            seen_full_ids.add(full_id)

            # Trouver le slot parent
            owner_slot = ISAMLTSlotsService._extract_slot_from_port_id(
                port_id, known_slot_short_ids
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

    # ================================================================
    # ===  4) Refresh complet — UNE SEULE SESSION, 2 COMMANDES  =======
    # ================================================================

    def refresh_all_single_session(
        self,
        timeout: int = 30,
        idle_timeout: float = 3.0,
        post_send_delay: float = 1.0,
        inter_command_delay: float = 1.0,
    ) -> Tuple[
        bool,
        str,
        List[Dict[str, Any]],
        str,
    ]:
        """
        Récupère les slots LT ET les ports dans UNE SEULE session Telnet.

        STRATÉGIE v3 — 2 COMMANDES SEULEMENT :
          1. "show equipment slot | match exact:lt:" → liste des slots
          2. "show interface port" → TOUS les ports de TOUS les slots

        Ensuite on parse le buffer de la commande 2 et on répartit
        chaque port dans le bon slot grâce à son port_id.

        Plus de décalage possible car il n'y a qu'UNE commande port.
        """
        logger.info(
            "[LT_SINGLE] Refresh complet single-session pour instance #%s (%s)",
            self.instance.id,
            self.instance.name,
        )

        session = ISAMPersistentTelnet(self.instance, timeout=timeout)
        ok, connect_msg = session.connect()

        if not ok:
            logger.error("[LT_SINGLE] Impossible d'ouvrir la session : %s", connect_msg)
            return False, "", [], connect_msg

        try:
            # ── 1. Récupérer les slots ──────────────────────────────
            cmd_slots = "show equipment slot | match exact:lt:"
            logger.info("[LT_SINGLE] Envoi commande slots : %r", cmd_slots)

            ok_s, raw_slots, err_s = session.execute(
                cmd_slots,
                idle_timeout=idle_timeout,
                post_send_delay=post_send_delay,
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

            # ── 2. Identifier les slots non-vides ────────────────────
            non_empty_slots = [
                s for s in slots
                if s.get("board", "").lower() != "empty"
            ]
            known_slot_short_ids = [
                s["slot_short_id"] for s in non_empty_slots
                if s.get("slot_short_id")
            ]

            logger.info(
                "[LT_SINGLE] %d slots non-vides : %s",
                len(non_empty_slots),
                ", ".join(known_slot_short_ids),
            )

            if not known_slot_short_ids:
                logger.info("[LT_SINGLE] Aucun slot non-vide, pas de ports à récupérer")
                for s in slots:
                    s["ports"] = []
                return True, raw_slots, slots, "OK"

            # ── 3. UNE SEULE commande pour TOUS les ports ────────────
            time.sleep(inter_command_delay)

            cmd_all_ports = "show interface port"
            logger.info("[LT_SINGLE] Envoi commande globale ports : %r", cmd_all_ports)

            # Timeout plus long car cette commande peut être volumineuse
            ok_p, raw_all_ports, err_p = session.execute(
                cmd_all_ports,
                idle_timeout=max(idle_timeout, 5.0),
                post_send_delay=post_send_delay,
            )

            if not ok_p:
                msg = f"Erreur commande ports globale : {err_p}"
                logger.error("[LT_SINGLE] %s", msg)
                # On retourne quand même les slots sans ports
                for s in slots:
                    s["ports"] = []
                return True, raw_slots, slots, f"Slots OK mais ports KO : {err_p}"

            logger.info(
                "[LT_SINGLE] Sortie ports globale : %d octets",
                len(raw_all_ports),
            )

            # ── 4. Parser et répartir les ports ──────────────────────
            ports_by_slot_short = self._parse_all_ports_from_buffer(
                raw_all_ports,
                known_slot_short_ids,
            )

            # ── 5. Assigner les ports à chaque slot ──────────────────
            for slot in slots:
                slot_short_id = slot.get("slot_short_id", "")
                if slot_short_id in ports_by_slot_short:
                    slot["ports"] = ports_by_slot_short[slot_short_id]
                else:
                    slot["ports"] = []

                logger.info(
                    "[LT_SINGLE] Slot %s → %d ports (types: %s)",
                    slot["slot_id"],
                    len(slot["ports"]),
                    ", ".join(sorted({p["port_type"] for p in slot["ports"]})) or "(aucun)",
                )

            total_ports = sum(len(s.get("ports", [])) for s in slots)
            logger.info(
                "[LT_SINGLE] Refresh terminé : %d slots, %d ports au total",
                len(slots),
                total_ports,
            )

            return True, raw_slots, slots, "OK"

        finally:
            session.close()