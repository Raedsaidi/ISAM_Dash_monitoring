'''
import logging
import re
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

    # ---------- 4) WAN Model extraction from template name ----------

    @staticmethod
    def extract_wan_model_from_template_name(
        template_name: str,
        known_model_names: List[str],
    ) -> Optional[str]:
        """
        Extrait le WAN model depuis le nom du template.

        Exemples:
          - GPON-DHCP -> GPON
          - USERNAME_GPON-DHCP_Generic -> GPON
          - ETHERNET_ORANGE -> ETHERNET
          - ETHERNET-PPP6_ORANGE -> ETHERNET
          - USER_XDSL_DATA -> XDSL

        On découpe le nom sur:
          - underscore _
          - tiret -
          - espaces
        """
        if not template_name or not known_model_names:
            return None

        models_lookup: Dict[str, str] = {}
        for model_name in known_model_names:
            normalized = model_name.strip().upper()
            if normalized:
                models_lookup[normalized] = model_name.strip()

        tokens = re.split(r"[_\-\s]+", template_name.strip().upper())

        for token in tokens:
            token = token.strip()
            if not token:
                continue

            if token in models_lookup:
                found = models_lookup[token]
                logger.info(
                    "[DATA] WAN model '%s' found in template name '%s' (token: '%s')",
                    found,
                    template_name,
                    token,
                )
                return found

        logger.warning(
            "[DATA] No WAN model found in template name '%s'. "
            "Tokens tested: %s. Known models: %s",
            template_name,
            tokens,
            known_model_names,
        )
        return None

    # ---------- 5) Post-apply DOWN command for specific WAN models ----------

    def execute_bridge_port_down_if_needed(
        self,
        *,
        port: str,
        wan_model: str,
        timeout: int = 30,
    ) -> Tuple[bool, str, List[str], str]:
        """
        Exécute uniquement:
            configure bridge no port {port}

        MAIS seulement si le WAN model est:
          - ETHERNET
          - XDSL

        Pour les autres WAN models, aucune commande supplémentaire n'est exécutée.

        Retourne:
            (success, raw_output, commands_list, message)
        """
        normalized_model = (wan_model or "").strip().upper()

        if normalized_model not in {"ETHERNET", "XDSL"}:
            logger.info(
                "[DATA] No bridge-port down action required for WAN model '%s' on port %s",
                normalized_model,
                port,
            )
            return True, "", [], f"No down command required for WAN model '{normalized_model}'."

        cmd_down = f"configure bridge no port {port}"
        commands = [cmd_down]

        logger.info(
            "[DATA] Executing bridge down command for WAN model '%s' on port %s: %s",
            normalized_model,
            port,
            cmd_down,
        )

        ok, proto, out, err = self.conn_service.execute_command_preference(
            command=cmd_down,
            timeout=timeout,
        )

        if not ok:
            msg = err or f"Bridge down command failed for WAN model '{normalized_model}'."
            logger.warning("[DATA] %s", msg)
            return False, out or "", commands, msg

        logger.info(
            "[DATA] Bridge down command executed successfully for WAN model '%s' on port %s",
            normalized_model,
            port,
        )

        return True, out or "", commands, f"Down command executed for WAN model '{normalized_model}'."

    # ---------- 6) Compat old endpoint ----------

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
    

'''
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

from app.models.isam_instance import ISAMInstance
from app.models.wan_template import WanTemplate
from app.services.isam_connection import ISAMConnectionService, Protocol

logger = logging.getLogger(__name__)


class ISAMDataService:
    """
    Service pour récupérer/appliquer des données/templates depuis une instance ISAM.
    """

    TEMPLATE_VAR_REGEX = re.compile(r"\[\[\$(.+?)\]\]")

    def __init__(self, instance: ISAMInstance):
        self.instance = instance
        self.conn_service = ISAMConnectionService(instance)

    # =========================================================
    # OUTILS INTERNES
    # =========================================================

    @staticmethod
    def _normalize_cli_output(raw_output: str) -> str:
        """
        Nettoyage léger de la sortie CLI provenant d'un shell interactif :
        - supprime \r
        - retire lignes vides parasites
        - conserve la sortie utile autant que possible
        """
        if not raw_output:
            return ""

        text = raw_output.replace("\r", "")
        lines = text.splitlines()

        cleaned_lines: List[str] = []
        for line in lines:
            # On garde la ligne, mais sans espaces finaux
            stripped_right = line.rstrip()

            # Ignore lignes totalement vides répétitives
            if not stripped_right.strip():
                cleaned_lines.append("")
                continue

            cleaned_lines.append(stripped_right)

        # Réduction des multiples lignes vides successives
        normalized: List[str] = []
        previous_blank = False
        for line in cleaned_lines:
            is_blank = not line.strip()
            if is_blank and previous_blank:
                continue
            normalized.append(line)
            previous_blank = is_blank

        return "\n".join(normalized).strip()

    @staticmethod
    def _remove_command_echo_lines(raw_output: str, command: str) -> str:
        """
        Retire les lignes qui correspondent exactement aux lignes de commande envoyées.
        Très utile avec invoke_shell(), où le terminal réaffiche souvent la commande.
        """
        if not raw_output:
            return ""

        command_lines = {
            line.strip()
            for line in (command or "").splitlines()
            if line.strip()
        }

        cleaned: List[str] = []
        for line in raw_output.splitlines():
            stripped = line.strip()
            if stripped in command_lines:
                continue
            cleaned.append(line)

        return "\n".join(cleaned).strip()

    @staticmethod
    def _remove_obvious_prompt_lines(raw_output: str) -> str:
        """
        Retire quelques prompts finaux évidents.
        On reste volontairement prudent pour ne pas supprimer de vraie donnée.
        """
        if not raw_output:
            return ""

        lines = raw_output.splitlines()

        prompt_patterns = [
            r"^[A-Za-z0-9._:/\-]+[>#]\s*$",
            r"^[A-Za-z0-9._:/\-]+\([A-Za-z0-9._:/\-]+\)[>#]\s*$",
        ]

        cleaned: List[str] = []
        for line in lines:
            stripped = line.strip()
            if any(re.match(pattern, stripped) for pattern in prompt_patterns):
                logger.debug("[DATA] Prompt ignoré dans la sortie CLI : %r", stripped)
                continue
            cleaned.append(line)

        return "\n".join(cleaned).strip()

    @classmethod
    def _prepare_output_for_parsing(cls, raw_output: str, command: str) -> str:
        """
        Pipeline de nettoyage avant parsing.
        """
        text = cls._normalize_cli_output(raw_output)
        text = cls._remove_command_echo_lines(text, command)
        text = cls._remove_obvious_prompt_lines(text)
        return text.strip()

    # =========================================================
    # 1) UTILISATION MÉMOIRE
    # =========================================================

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
            logger.error("[DATA] Impossible de récupérer l'utilisation mémoire : %s", msg)
            return False, protocol_used, raw_output or "", {}, msg

        prepared_output = self._prepare_output_for_parsing(raw_output or "", script)
        parsed = self._parse_memory_usage(prepared_output)

        logger.info(
            "[DATA] Utilisation mémoire récupérée et parsée pour %s (entries=%s, proto=%s).",
            self.instance.host,
            parsed.get("entry_count", 0),
            protocol_used,
        )
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
                        "[DATA] Impossible de parser 'memory-usage count' dans la ligne: %r",
                        original_line,
                    )
                break

            if set(line) <= {"-", "=", "+", "|"}:
                continue

            parts = line.split()
            if len(parts) < 4:
                logger.debug(
                    "[DATA] Ligne d'utilisation mémoire non reconnue : %r",
                    original_line,
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

    # =========================================================
    # 2) PORTS
    # =========================================================

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
            logger.error("[DATA] Impossible de récupérer les ports : %s", msg)
            return False, protocol_used, raw_output or "", {"ports": [], "port_count": 0}, msg

        prepared_output = self._prepare_output_for_parsing(raw_output or "", script)
        ports = self._parse_show_port(prepared_output)

        parsed = {
            "ports": ports,
            "port_count": len(ports),
        }

        logger.info(
            "[DATA] Ports récupérés et parsés pour %s (count=%s, proto=%s).",
            self.instance.host,
            len(ports),
            protocol_used,
        )
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

            lower = stripped.lower()
            if lower.startswith("port") and "admin" in lower and "link" in lower:
                in_table = True
                continue

            if stripped.startswith("=") or stripped.startswith("-"):
                continue

            if in_table and current_board:
                parts = stripped.split()
                if len(parts) < 10:
                    logger.debug("[PORTS] Ligne non reconnue : %r", line_orig)
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

    # =========================================================
    # 3) TEMPLATE ENGINE
    # =========================================================

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
            logger.error("[DATA] Erreur rendu template : %s", msg)
            return False, None, "", msg, []

        logger.info(
            "[DATA] Application du template sur port %s avec %s commandes.",
            selected_port,
            len(commands_executed),
        )

        ok, proto, out, err = self.conn_service.execute_command_preference(
            command="\n".join(commands_executed),
            timeout=timeout,
        )

        if not ok:
            msg = err or "Failed to apply rendered template."
            logger.error("[DATA] Échec application template : %s", msg)
            return False, proto, out or "", msg, commands_executed

        logger.info(
            "[DATA] Template appliqué avec succès sur port %s via protocole %s.",
            selected_port,
            proto,
        )
        return True, proto, out or "", "OK", commands_executed

    # =========================================================
    # 4) WAN MODEL EXTRACTION FROM TEMPLATE NAME
    # =========================================================

    @staticmethod
    def extract_wan_model_from_template_name(
        template_name: str,
        known_model_names: List[str],
    ) -> Optional[str]:
        """
        Extrait le WAN model depuis le nom du template.

        Exemples:
          - GPON-DHCP -> GPON
          - USERNAME_GPON-DHCP_Generic -> GPON
          - ETHERNET_ORANGE -> ETHERNET
          - ETHERNET-PPP6_ORANGE -> ETHERNET
          - USER_XDSL_DATA -> XDSL
        """
        if not template_name or not known_model_names:
            return None

        models_lookup: Dict[str, str] = {}
        for model_name in known_model_names:
            normalized = model_name.strip().upper()
            if normalized:
                models_lookup[normalized] = model_name.strip()

        tokens = re.split(r"[_\-\s]+", template_name.strip().upper())

        for token in tokens:
            token = token.strip()
            if not token:
                continue

            if token in models_lookup:
                found = models_lookup[token]
                logger.info(
                    "[DATA] WAN model '%s' trouvé dans le template '%s' (token='%s').",
                    found,
                    template_name,
                    token,
                )
                return found

        logger.warning(
            "[DATA] Aucun WAN model trouvé dans le template '%s'. Tokens testés=%s, modèles connus=%s",
            template_name,
            tokens,
            known_model_names,
        )
        return None

    # =========================================================
    # 5) POST-APPLY DOWN COMMAND
    # =========================================================

    def execute_bridge_port_down_if_needed(
        self,
        *,
        port: str,
        wan_model: str,
        timeout: int = 30,
    ) -> Tuple[bool, str, List[str], str]:
        """
        Exécute uniquement:
            configure bridge no port {port}

        MAIS seulement si le WAN model est:
          - ETHERNET
          - XDSL
        """
        normalized_model = (wan_model or "").strip().upper()

        if normalized_model not in {"ETHERNET", "XDSL"}:
            logger.info(
                "[DATA] Aucune commande bridge down requise pour WAN model '%s' sur port %s.",
                normalized_model,
                port,
            )
            return True, "", [], f"No down command required for WAN model '{normalized_model}'."

        cmd_down = f"configure bridge no port {port}"
        commands = [cmd_down]

        logger.info(
            "[DATA] Exécution commande bridge down pour WAN model '%s' sur port %s : %s",
            normalized_model,
            port,
            cmd_down,
        )

        ok, proto, out, err = self.conn_service.execute_command_preference(
            command=cmd_down,
            timeout=timeout,
        )

        if not ok:
            msg = err or f"Bridge down command failed for WAN model '{normalized_model}'."
            logger.warning("[DATA] %s", msg)
            return False, out or "", commands, msg

        logger.info(
            "[DATA] Commande bridge down exécutée avec succès pour WAN model '%s' sur port %s via %s.",
            normalized_model,
            port,
            proto,
        )

        return True, out or "", commands, f"Down command executed for WAN model '{normalized_model}'."

    # =========================================================
    # 6) COMPAT OLD ENDPOINT
    # =========================================================

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
