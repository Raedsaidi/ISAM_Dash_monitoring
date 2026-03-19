from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

from app.core.config import settings


class Base(DeclarativeBase):
    pass


# Pour SQLite + FastAPI :
# - check_same_thread=False : permet d'utiliser la même connexion dans plusieurs threads (Uvicorn)
engine = create_engine(
    settings.DB_URL,
    echo=False,
    future=True,
    connect_args={"check_same_thread": False} if settings.DB_URL.startswith("sqlite") else {},
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()