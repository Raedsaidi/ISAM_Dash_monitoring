# app/services/auth_client.py
import requests
from fastapi import HTTPException, status

from app.core.config import settings


def fetch_current_user_profile(token: str) -> dict:
    """
    Appelle auth-service /me avec le même JWT que l'utilisateur,
    et renvoie le profil utilisateur complet (incl. port_value).
    """
    url = f"{settings.AUTH_SERVICE_URL}/api/v1/auth/me"

    headers = {
        "Authorization": f"Bearer {token}",
    }

    try:
        resp = requests.get(url, headers=headers, timeout=5)
    except requests.RequestException as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to contact auth-service /me: {e}",
        )

    try:
        data = resp.json()
    except ValueError:
        data = None

    if not resp.ok:
        detail = (data or {}).get("detail") or "auth-service /me returned an error"
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"auth-service /me error: {detail}",
        )

    if not isinstance(data, dict):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="auth-service /me returned invalid payload.",
        )

    return data