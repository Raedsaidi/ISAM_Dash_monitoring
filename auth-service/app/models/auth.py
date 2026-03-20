from datetime import datetime
import re
from typing import Annotated, Optional

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    field_validator,
)

from app.models.user import UserRole


# =========================================================
# Regex / constantes
# =========================================================

# port.value :
# uniquement des nombres séparés par "/"
# ex: 1/1/7/3  ou  1/1/5/35/9
PORT_VALUE_REGEX = re.compile(r"^\d+(?:/\d+)*$")

PORT_LABEL_EXTRA_CHARS = {" ", "_", "-", ".", "/", "(", ")"}


# =========================================================
# Types réutilisables
# =========================================================

UsernameStr = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=3, max_length=32),
]

FullNameStr = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=2, max_length=100),
]

PasswordStr = Annotated[
    str,
    StringConstraints(min_length=8, max_length=72),
]

RefreshTokenStr = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=20, max_length=2000),
]

PortValueStr = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=100),
]

PortLabelStr = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=50),
]


# =========================================================
# Helpers
# =========================================================

def contains_letter(value: str) -> bool:
    return any(ch.isalpha() for ch in value)


def is_only_digits_ignoring_spaces(value: str) -> bool:
    """
    True si (en ignorant les espaces) la chaîne est uniquement des chiffres.
    Ex: "123" -> True, "12 3" -> True, "123_" -> False, "raed33" -> False
    """
    compact = value.replace(" ", "")
    return bool(compact) and compact.isdigit()


def is_valid_full_name(value: str) -> bool:
    """
    Autorise uniquement:
    - lettres
    - espaces
    """
    return all(ch.isalpha() or ch == " " for ch in value)


def is_valid_port_label(value: str) -> bool:
    return all(ch.isalnum() or ch in PORT_LABEL_EXTRA_CHARS for ch in value)


# =========================================================
# Bases communes
# =========================================================

class StrictInputModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ORMReadModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# =========================================================
# Tokens
# =========================================================

class Token(BaseModel):
    access_token: str
    refresh_token: str


class RefreshTokenRequest(StrictInputModel):
    refresh_token: RefreshTokenStr

    @field_validator("refresh_token")
    @classmethod
    def validate_refresh_token(cls, v: str) -> str:
        if any(ch.isspace() for ch in v):
            raise ValueError("Le refresh token ne doit pas contenir d'espaces.")
        return v


class TokenData(BaseModel):
    """
    Utilisé par app.core.security pour représenter les infos extraites du JWT.
    """
    username: Optional[str] = None
    role: Optional[UserRole] = None


# =========================================================
# Base commune pour création user
# =========================================================

class UserInputBase(StrictInputModel):
    username: UsernameStr
    email: EmailStr
    full_name: FullNameStr
    password: PasswordStr

    @field_validator("username")
    @classmethod
    def validate_username(cls, v: str) -> str:
        # Username accepte "tout" (caractères), MAIS règles business :
        # - pas uniquement chiffres (même avec espaces)
        # - pas de tabulations / retours ligne
        if is_only_digits_ignoring_spaces(v):
            raise ValueError("Le nom d'utilisateur ne doit pas être uniquement composé de chiffres.")

        if any(ch in v for ch in ("\n", "\r", "\t")):
            raise ValueError("Le nom d'utilisateur ne doit pas contenir de retours ligne ou tabulations.")

        return v

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, v):
        if isinstance(v, str):
            return v.strip().lower()
        return v

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: EmailStr) -> EmailStr:
        if len(str(v)) > 254:
            raise ValueError("L'adresse email est trop longue.")
        return v

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, v: str) -> str:
        # interdit full_name sans lettres (ex: "123")
        if not contains_letter(v):
            raise ValueError("Le nom complet doit contenir au moins une lettre et ne doit pas être uniquement numérique.")

        if not is_valid_full_name(v):
            raise ValueError("Le nom complet ne peut contenir que des lettres et des espaces.")

        if "  " in v:
            raise ValueError("Le nom complet ne doit pas contenir d'espaces doubles.")

        return v

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if any(ch.isspace() for ch in v):
            raise ValueError("Le mot de passe ne doit pas contenir d'espaces.")

        if not any(ch.islower() for ch in v):
            raise ValueError("Le mot de passe doit contenir au moins une lettre minuscule.")

        if not any(ch.isupper() for ch in v):
            raise ValueError("Le mot de passe doit contenir au moins une lettre majuscule.")

        if not any(ch.isdigit() for ch in v):
            raise ValueError("Le mot de passe doit contenir au moins un chiffre.")

        if not any(not ch.isalnum() for ch in v):
            raise ValueError("Le mot de passe doit contenir au moins un caractère spécial.")

        return v


# =========================================================
# Self-register
# =========================================================

class UserCreateSelf(UserInputBase):
    pass


# =========================================================
# Ports utilisateur
# =========================================================

class UserPortCreate(StrictInputModel):
    label: Optional[PortLabelStr] = None
    value: PortValueStr

    @field_validator("label", mode="before")
    @classmethod
    def normalize_label(cls, v):
        if v is None:
            return None
        if isinstance(v, str):
            v = v.strip()
            return v or None
        return v

    @field_validator("label")
    @classmethod
    def validate_label(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None

        if "  " in v:
            raise ValueError("Le label du port ne doit pas contenir d'espaces doubles.")

        if not is_valid_port_label(v):
            raise ValueError("Le label du port contient des caractères non autorisés.")

        return v

    @field_validator("value")
    @classmethod
    def validate_value(cls, v: str) -> str:
        if any(ch.isspace() for ch in v):
            raise ValueError("La valeur du port ne doit pas contenir d'espaces.")

        if not PORT_VALUE_REGEX.fullmatch(v):
            raise ValueError(
                "La valeur du port est invalide. Format attendu: nombres séparés par '/' (ex: 1/1/7/3)."
            )

        return v


class UserPortRead(ORMReadModel):
    id: int
    label: Optional[str] = None
    value: str


# =========================================================
# Création user via ADMIN / SUPER_ADMIN
# =========================================================

class AdminUserCreate(UserInputBase):
    role: UserRole
    ports: list[UserPortCreate] = Field(..., min_length=1, max_length=20)

    @field_validator("ports")
    @classmethod
    def validate_ports(cls, v: list[UserPortCreate]) -> list[UserPortCreate]:
        seen = set()
        for port in v:
            normalized = port.value  # digits + "/" => pas besoin lower()
            if normalized in seen:
                raise ValueError("Les ports dupliqués ne sont pas autorisés.")
            seen.add(normalized)
        return v


# =========================================================
# Lecture user standard
# =========================================================

class UserRead(ORMReadModel):
    id: int
    username: str
    email: EmailStr
    full_name: str
    role: UserRole
    is_active: bool

    # compat ancien système
    port_label: Optional[str] = None
    port_value: Optional[str] = None

    # nouveau système
    ports: list[UserPortRead] = Field(default_factory=list)

    created_at: Optional[datetime] = None
    last_login_at: Optional[datetime] = None


# =========================================================
# Lecture user côté admin
# =========================================================

class UserAdminRead(ORMReadModel):
    id: int
    username: str
    email: EmailStr
    full_name: str
    role: UserRole
    is_active: bool

    # Champs historiques
    port_label: Optional[str] = None
    port_value: Optional[str] = None
    password_hash: str

    # Nouvelle liste complète des ports
    ports: list[UserPortRead] = Field(default_factory=list)


class UserList(BaseModel):
    users: list[UserAdminRead]


class ChangeRoleRequest(StrictInputModel):
    role: UserRole