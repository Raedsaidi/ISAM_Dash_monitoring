from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from pydantic import BaseModel

from app.core.config import settings


security = HTTPBearer()  # Schéma Bearer simple dans Swagger


class TokenUser(BaseModel):
    username: str
    role: str


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> TokenUser:
    """
    Récupère le JWT envoyé via Authorization: Bearer <token>,
    le décode et vérifie la signature.
    """
    token = credentials.credentials

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token invalide ou expiré.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
        username: Optional[str] = payload.get("sub")
        role: Optional[str] = payload.get("role")
        if username is None or role is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    return TokenUser(username=username, role=role)


async def require_admin(current_user: TokenUser = Depends(get_current_user)) -> TokenUser:
    """
    Autorise uniquement les rôles ADMIN et SUPER_ADMIN.
    """
    if current_user.role not in ("ADMIN", "SUPER_ADMIN"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accès réservé aux ADMIN / SUPER_ADMIN.",
        )
    return current_user


async def require_super_admin(current_user: TokenUser = Depends(get_current_user)) -> TokenUser:
    if current_user.role != "SUPER_ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accès réservé au SUPER_ADMIN.",
        )
    return current_user