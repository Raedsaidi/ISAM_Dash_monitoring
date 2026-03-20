import logging
from datetime import datetime , timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.endpoints.auth import router as auth_router
from app.core.config import settings
from app.core.db import Base, engine, SessionLocal
from app.core.security import get_password_hash
from app.models.user import User, UserRole


def configure_logging():
    logging.basicConfig(
        level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    )


def bootstrap_super_admin():
    """
    Crée un SUPER_ADMIN initial si aucun n'existe.
    """
    db = SessionLocal()
    try:
        existing_sa = (
            db.query(User)
            .filter(User.role == UserRole.SUPER_ADMIN.value)
            .first()
        )
        if existing_sa:
            return

        user = User(
            username=settings.INITIAL_SUPERADMIN_USERNAME,
            email=settings.INITIAL_SUPERADMIN_EMAIL,
            full_name=settings.INITIAL_SUPERADMIN_FULL_NAME,
            password_hash=get_password_hash(settings.INITIAL_SUPERADMIN_PASSWORD),
            role=UserRole.SUPER_ADMIN.value,
            is_active=True,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc)
        )
        db.add(user)
        db.commit()
    finally:
        db.close()


def create_app() -> FastAPI:
    configure_logging()

    app = FastAPI(
        title=settings.APP_NAME,
        version="1.0.0",
        description="Microservice d'authentification (JWT + SQLite + rôles).",
    )

    # -------- CORS --------
    origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,          # en dev, tu peux mettre ["*"] si tu veux tout autoriser
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    # ----------------------

    # Créer les tables
    Base.metadata.create_all(bind=engine)

    # Créer le superadmin si nécessaire
    bootstrap_super_admin()

    # Routes
    app.include_router(auth_router, prefix="/api/v1")

    @app.get("/health", tags=["Health"])
    def health():
        return {"status": "ok", "environment": settings.ENVIRONMENT}

    return app


app = create_app()