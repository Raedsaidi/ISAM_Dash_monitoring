from typing import List, Optional, Dict, Literal

from pydantic import BaseModel, Field

Protocol = Literal["ssh", "telnet"]


class ConnectionStatus(BaseModel):
    success: bool = Field(..., description="True si la connexion a réussi.")
    message: str = Field(..., description="Message détaillant le résultat.")


class ConnectionTestResponse(BaseModel):
    telnet: ConnectionStatus
    ssh: ConnectionStatus
    global_status: str = Field(
        ...,
        description="Résumé global : au moins une connexion réussie ou aucune.",
    )


class RunCommandRequest(BaseModel):
    command: str = Field(..., description="Commande CLI à exécuter sur l’ISAM.")
    protocol_preference: Literal["auto", "ssh", "telnet"] = Field(
        default="auto",
        description="Protocole préféré : 'ssh', 'telnet' ou 'auto' pour tenter SSH puis Telnet.",
    )
    timeout: int = Field(
        default=20, description="Timeout en secondes pour l’exécution de la commande."
    )


class RunCommandResponse(BaseModel):
    success: bool
    protocol_used: Optional[Protocol]
    stdout: str = Field("", description="Sortie standard / output de la commande.")
    stderr_or_message: str = Field(
        "", description="Sortie d’erreur de la commande ou message d’erreur global."
    )


class BasicInfoResponse(BaseModel):
    success: bool
    protocol_used: Optional[Protocol]
    raw_output: str
    parsed: Dict[str, str]
    message: str


class LicenseItem(BaseModel):
    feature: str = Field(..., description="Nom de la fonctionnalité/licence.")
    number_license: int = Field(..., description="Nombre de licences pour cette fonctionnalité.")


class LicensesResponse(BaseModel):
    success: bool
    protocol_used: Optional[Protocol]
    license_count: int = Field(0, description="Nombre total de lignes de licence.")
    licenses: List[LicenseItem] = Field(default_factory=list)
    message: str = Field("", description="Message d'information ou d'erreur.")


class OntInterfaceInfo(BaseModel):
    interface: str
    sw_ver_pland: Optional[str] = None
    desc1: Optional[str] = None
    sernum: Optional[str] = None
    subslocid: Optional[str] = None
    fec_up: Optional[str] = None
    sw_dnload_version: Optional[str] = None
    log_auth_pwd: Optional[str] = None
    planned_us_rate: Optional[str] = None
    admin_state: Optional[str] = None


class OntInterfaceInfoResponse(BaseModel):
    success: bool
    protocol_used: Optional[Protocol]
    interface_id: str
    info: Optional[OntInterfaceInfo] = None
    message: str

class PortItem(BaseModel):
    board: str = Field(..., description="Carte / contexte (ex: NT, NT-A, LT, …)")
    port_id: str = Field(..., description="Identifiant du port (ex: nt-a:eth:1, lt:1/1/7)")
    admin_state: str
    link_state: str
    port_state: str
    cfg_mtu: int
    oper_mtu: int
    lag_bndl: str
    mode: str
    encap: str
    port_type: str


class PortsResponse(BaseModel):
    success: bool
    protocol_used: Optional[Protocol]
    port_count: int
    ports: List[PortItem]
    raw_output: str
    message: str