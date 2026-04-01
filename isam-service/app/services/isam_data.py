import logging
import re
import time
from typing import Dict, Optional, Tuple, List, Any

from app.services.isam_connection import ISAMConnectionService, Protocol
from app.models.isam_instance import ISAMInstance
from app.models.wan_template import WanTemplate

logger = logging.getLogger(__name__)


class ISAMDataService:
    """
    Service pour récupérer/appliquer des données/templates depuis une instance ISAM.
    """

    TEMPLATE_VAR_REGEX = re.compile(r"\[\[\$(.+?)\]\]")

    def __init__(self, instance: ISAMInstance):
        self.instance = instance
        self.conn_service = ISAMConnectionService(instance)

    # ---------- 1) Utilisation mémoire ----------

    def get_memory_usage(
        self,
        timeout: int = 20,
    ) -> Tuple[bool, Optional[Protocol], str, Dict[str, Any], str]:
        script = "show\nsystem\nmemory-usage"

        success, protocol_used, raw_output, msg = self.conn_service.execute_command_preference(
            command=script,
            timeout=timeout,
        )

        if not success:
            logger.error(f"[DATA] Impossible de récupérer l'utilisation mémoire : {msg}")
            return False, protocol_used, raw_output or "", {}, msg

        parsed = self._parse_memory_usage(raw_output or "")
        logger.info("[DATA] Utilisation mémoire récupérée et parsée.")
        return True, protocol_used, raw_output or "", parsed, "OK"

    @staticmethod
    def _parse_memory_usage(raw_output: str) -> Dict[str, Any]:
        entries: List[Dict[str, Any]] = []
        parsed: Dict[str, Any] = {}
        in_table = False

        for line in raw_output.splitlines():
            original_line = line
            line = line.strip()
            if not line:
                continue

            lower = line.lower()

            if (
                "slot" in lower
                and "total" in lower
                and "used" in lower
                and "portion" in lower
            ):
                in_table = True
                continue

            if not in_table:
                continue

            if "memory-usage count" in lower:
                try:
                    after_colon = line.split(":", 1)[1].strip()
                    count_str = after_colon.split()[0]
                    parsed["entry_count"] = int(count_str)
                except Exception:
                    logger.debug(
                        f"[DATA] Impossible de parser 'memory-usage count' dans la ligne: {original_line!r}"
                    )
                break

            if set(line) <= {"-", "=", "+", "|"}:
                continue

            parts = line.split()
            if len(parts) < 4:
                logger.debug(
                    f"[DATA] Ligne d'utilisation mémoire non reconnue : {original_line!r}"
                )
                continue

            slot = parts[0]
            total_mb_str = parts[1]
            used_mb_str = parts[2]
            used_percent_str = parts[3]

            try:
                total_mb = int(total_mb_str)
            except ValueError:
                total_mb = 0
            try:
                used_mb = int(used_mb_str)
            except ValueError:
                used_mb = 0
            try:
                used_percent = int(used_percent_str.replace("%", ""))
            except ValueError:
                used_percent = 0

            entries.append(
                {
                    "slot": slot,
                    "total_mb": total_mb,
                    "used_mb": used_mb,
                    "used_percent": used_percent,
                }
            )

        parsed["entries"] = entries
        if "entry_count" not in parsed:
            parsed["entry_count"] = len(entries)

        return parsed

    # ---------- 2) Ports ----------

    def get_ports(
        self,
        timeout: int = 30,
    ) -> Tuple[bool, Optional[Protocol], str, Dict[str, Any], str]:
        script = "show\nport"

        success, protocol_used, raw_output, msg = self.conn_service.execute_command_preference(
            command=script,
            timeout=timeout,
        )

        if not success:
            logger.error(f"[DATA] Impossible de récupérer les ports : {msg}")
            return False, protocol_used, raw_output or "", {"ports": [], "port_count": 0}, msg

        ports = self._parse_show_port(raw_output or "")
        parsed = {
            "ports": ports,
            "port_count": len(ports),
        }

        logger.info("[DATA] Ports récupérés et parsés.")
        return True, protocol_used, raw_output or "", parsed, "OK"

    @staticmethod
    def _parse_show_port(raw_output: str) -> List[Dict[str, Any]]:
        ports: List[Dict[str, Any]] = []
        current_board: str | None = None
        in_table: bool = False

        for line_orig in raw_output.splitlines():
            line = line_orig.rstrip("\n")
            stripped = line.strip()
            if not stripped:
                in_table = False
                continue

            if stripped.startswith("Ports on "):
                current_board = stripped[len("Ports on "):].strip()
                in_table = False
                continue

            if (
                stripped.lower().startswith("port")
                and "admin" in stripped.lower()
                and "link" in stripped.lower()
            ):
                in_table = True
                continue

            if stripped.startswith("=") or stripped.startswith("-"):
                continue

            if in_table and current_board:
                parts = stripped.split()
                if len(parts) < 10:
                    logger.debug(f"[PORTS] Ligne non reconnue : {line_orig!r}")
                    continue

                port_id = parts[0]
                admin_state = parts[1]
                link_state = parts[2]
                port_state = parts[3]
                cfg_mtu = parts[4]
                oper_mtu = parts[5]
                lag_bndl = parts[6]
                mode = parts[7]
                encap = parts[8]
                port_type = parts[9]

                try:
                    cfg_mtu_int = int(cfg_mtu)
                except ValueError:
                    cfg_mtu_int = 0
                try:
                    oper_mtu_int = int(oper_mtu)
                except ValueError:
                    oper_mtu_int = 0

                ports.append(
                    {
                        "board": current_board,
                        "port_id": port_id,
                        "admin_state": admin_state,
                        "link_state": link_state,
                        "port_state": port_state,
                        "cfg_mtu": cfg_mtu_int,
                        "oper_mtu": oper_mtu_int,
                        "lag_bndl": lag_bndl,
                        "mode": mode,
                        "encap": encap,
                        "port_type": port_type,
                    }
                )

        return ports

    # ---------- 3) Template engine ----------

    @classmethod
    def extract_template_variables(cls, commands_template: str) -> List[str]:
        seen = set()
        result: List[str] = []

        for match in cls.TEMPLATE_VAR_REGEX.finditer(commands_template or ""):
            name = match.group(1).strip()
            if name and name not in seen:
                seen.add(name)
                result.append(name)

        return result

    @classmethod
    def render_template_commands(
        cls,
        commands_template: str,
        *,
        selected_port: str | None = None,
        variables: Dict[str, Any] | None = None,
    ) -> Tuple[str, List[str], List[str]]:
        variables = variables or {}

        values: Dict[str, str] = {}
        for k, v in variables.items():
            key = str(k).strip()
            if not key:
                continue
            values[key] = "" if v is None else str(v)

        # variables réservées
        if selected_port:
            values.setdefault("port", selected_port)
            values.setdefault("port_id", selected_port)

        detected = cls.extract_template_variables(commands_template)

        missing = [name for name in detected if not str(values.get(name, "")).strip()]
        if missing:
            raise ValueError(
                "Missing values for variables: " + ", ".join(missing)
            )

        def replacer(match: re.Match) -> str:
            name = match.group(1).strip()
            return str(values.get(name, ""))

        rendered = cls.TEMPLATE_VAR_REGEX.sub(replacer, commands_template)

        # compat ancien style {port_id}
        legacy_context: Dict[str, str] = {}
        for key, value in values.items():
            legacy_context[key] = value
            legacy_context[key.replace(" ", "_")] = value

        try:
            rendered = rendered.format(**legacy_context)
        except KeyError as e:
            missing_legacy = str(e).strip("'")
            raise ValueError(
                f"Missing value for legacy placeholder {{{missing_legacy}}}"
            )

        commands: List[str] = []
        for line in rendered.splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            if re.fullmatch(r"[-=]{3,}", stripped):
                continue
            if stripped.startswith("#"):
                continue
            commands.append(stripped)

        if not commands:
            raise ValueError("Rendered template is empty (no executable commands).")

        return rendered, commands, detected

    def apply_template_content(
        self,
        *,
        commands_template: str,
        selected_port: str,
        variables: Dict[str, Any] | None = None,
        timeout: int = 60,
    ) -> Tuple[bool, Optional[Protocol], str, str, List[str]]:
        try:
            rendered_script, commands_executed, _ = self.render_template_commands(
                commands_template,
                selected_port=selected_port,
                variables=variables,
            )
        except ValueError as e:
            msg = str(e)
            logger.error(f"[DATA] {msg}")
            return False, None, "", msg, []

        logger.info(
            f"[DATA] Applying rendered template on port {selected_port} "
            f"with {len(commands_executed)} commands."
        )

        ok, proto, out, err = self.conn_service.execute_command_preference(
            command="\n".join(commands_executed),
            timeout=timeout,
        )

        if not ok:
            msg = err or "Failed to apply rendered template."
            logger.error(f"[DATA] {msg}")
            return False, proto, out or "", msg, commands_executed

        return True, proto, out or "", "OK", commands_executed

    # ---------- 5) Admin-state cycle (down + up) ----------

    def execute_admin_state_cycle(
        self,
        port: str,
        delay_seconds: float = 2.0,
        timeout: int = 30,
    ) -> Tuple[bool, str, List[str], str]:
        """
        Exécute un cycle admin-state down puis up sur le port spécifié.

        1. configure equipment ont interface {port} admin-state down
        2. Pause de delay_seconds secondes
        3. configure equipment ont interface {port} admin-state up

        Retourne:
            (success, raw_output_combined, commands_list, message)
        """
        cmd_down = f"configure "
        cmd_up = f"configure "

        commands = [cmd_down, cmd_up]
        combined_output = ""

        logger.info(
            "[DATA] Admin-state cycle: executing DOWN on port %s", port
        )

        # ── Step 1: admin-state down ──
        ok_down, proto_down, out_down, err_down = self.conn_service.execute_command_preference(
            command=cmd_down,
            timeout=timeout,
        )

        combined_output += f"\n--- admin-state down ---\n{out_down or ''}"

        if not ok_down:
            msg = f"Admin-state DOWN failed: {err_down}"
            logger.warning("[DATA] %s", msg)
            return False, combined_output, commands, msg

        logger.info(
            "[DATA] Admin-state DOWN OK. Waiting %.1f seconds before UP...",
            delay_seconds,
        )

        # ── Step 2: pause ──
        time.sleep(delay_seconds)

        # ── Step 3: admin-state up ──
        logger.info(
            "[DATA] Admin-state cycle: executing UP on port %s", port
        )

        ok_up, proto_up, out_up, err_up = self.conn_service.execute_command_preference(
            command=cmd_up,
            timeout=timeout,
        )

        combined_output += f"\n--- admin-state up ---\n{out_up or ''}"

        if not ok_up:
            msg = f"Admin-state UP failed: {err_up}"
            logger.warning("[DATA] %s", msg)
            return False, combined_output, commands, msg

        logger.info(
            "[DATA] Admin-state cycle completed successfully on port %s",
            port,
        )

        return True, combined_output, commands, "Admin-state cycle OK (down → up)"

    # ---------- 6) WAN Model extraction from template name ----------

    @staticmethod
    def extract_wan_model_from_template_name(
        template_name: str,
        known_model_names: List[str],
    ) -> Optional[str]:
        """
        Extrait le modèle WAN du nom d'un template.

        Logique :
          1. Splitter le nom par "_" → chaque segment est un candidat
          2. Chercher chaque segment (tel quel, avec ses "-") dans known_model_names
          3. Retourner le premier match (case-insensitive)

    
        """
        if not template_name or not known_model_names:
            return None

        # Construire un lookup case-insensitive
        # Clé = nom en majuscules, Valeur = nom original tel qu'en base
        models_lookup: Dict[str, str] = {}
        for model_name in known_model_names:
            models_lookup[model_name.upper().strip()] = model_name.strip()

        # Splitter par "_"
        segments = template_name.split("_")

        # Chercher chaque segment dans les modèles connus
        for segment in segments:
            segment_upper = segment.strip().upper()
            if segment_upper in models_lookup:
                found = models_lookup[segment_upper]
                logger.info(
                    "[DATA] WAN model '%s' found in template name '%s' (segment: '%s')",
                    found,
                    template_name,
                    segment,
                )
                return found

        logger.warning(
            "[DATA] No WAN model found in template name '%s'. "
            "Segments tested: %s. Known models: %s",
            template_name,
            segments,
            known_model_names,
        )
        return None

    # ---------- 4) Compat old endpoint ----------

    def apply_wan_template(
        self,
        port_id: str,
        template: WanTemplate,
        timeout: int = 60,
    ) -> Tuple[bool, Optional[Protocol], str, str, List[str]]:
        return self.apply_template_content(
            commands_template=template.commands_template,
            selected_port=port_id,
            variables={},
            timeout=timeout,
        )