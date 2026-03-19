from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, EmailStr

from app.models.user import UserRole


# -------- Tokens --------

class Token(BaseModel):
    access_token: str
    refresh_token: str


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class TokenData(BaseModel):
    """
    Utilisé par app.core.security pour représenter les infos extraites du JWT.
    """
    username: Optional[str] = None
    role: Optional[UserRole] = None


# -------- Self-register (visiteur) --------

class UserCreateSelf(BaseModel):
    username: str
    email: EmailStr
    full_name: str
    password: str


# -------- Ports utilisateur --------

class UserPortCreate(BaseModel):
    label: Optional[str] = None
    value: str


class UserPortRead(BaseModel):
    id: int
    label: Optional[str] = None
    value: str

    class Config:
        from_attributes = True  # Pydantic v2 (ancien orm_mode = True)


# -------- Création user via ADMIN / SUPER_ADMIN --------

class AdminUserCreate(BaseModel):
    username: str
    email: EmailStr
    full_name: str
    password: str
    role: UserRole
    # Liste de ports : au moins 1 côté validation métier / endpoint
    ports: List[UserPortCreate]


# -------- Lecture user standard (/me etc.) --------

class UserRead(BaseModel):
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
    ports: List[UserPortRead] = []

    created_at: Optional[datetime] = None
    last_login_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# -------- Lecture user côté admin --------

class UserAdminRead(BaseModel):
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
    ports: List[UserPortRead] = []

    class Config:
        from_attributes = True


class UserList(BaseModel):
    users: List[UserAdminRead]


class ChangeRoleRequest(BaseModel):
    role: UserRole