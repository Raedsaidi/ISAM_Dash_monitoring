import os
from dotenv import load_dotenv
from pydantic import BaseModel, Field

load_dotenv()


class Settings(BaseModel):
    APP_NAME: str = Field(default="auth-service")
    ENVIRONMENT: str = Field(default="dev")
    LOG_LEVEL: str = Field(default="INFO")

    # URL SQLite : fichier auth.db dans le répertoire du projet
    DB_URL: str = Field(default="sqlite:///./auth.db")

    JWT_SECRET_KEY: str = Field(default="GfN4v8jKQyG8p0LpjJ7dYQH9q2sLAX7m0pW3sZrTn9uN3xCyBh3FgTzW9Lk5QsM2")
    JWT_ALGORITHM: str = Field(default="HS256")
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(default=60)
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = Field(default=7)

    INITIAL_SUPERADMIN_USERNAME: str = Field(default="superadmin")
    INITIAL_SUPERADMIN_PASSWORD: str = Field(default="SuperAdmin123!")
    INITIAL_SUPERADMIN_EMAIL: str = Field(default="superadmin@example.com")
    INITIAL_SUPERADMIN_FULL_NAME: str = Field(default="Super Admin")


def get_settings() -> Settings:
    return Settings(
        APP_NAME=os.getenv("APP_NAME", "auth-service"),
        ENVIRONMENT=os.getenv("ENVIRONMENT", "dev"),
        LOG_LEVEL=os.getenv("LOG_LEVEL", "INFO"),

        DB_URL=os.getenv("DB_URL", "sqlite:///./auth.db"),

        JWT_SECRET_KEY=os.getenv("JWT_SECRET_KEY", "GfN4v8jKQyG8p0LpjJ7dYQH9q2sLAX7m0pW3sZrTn9uN3xCyBh3FgTzW9Lk5QsM2"),
        JWT_ALGORITHM=os.getenv("JWT_ALGORITHM", "HS256"),
        JWT_ACCESS_TOKEN_EXPIRE_MINUTES=int(
            os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "60")
        ),
        JWT_REFRESH_TOKEN_EXPIRE_DAYS=int(
            os.getenv("JWT_REFRESH_TOKEN_EXPIRE_DAYS", "7")
        ),

        INITIAL_SUPERADMIN_USERNAME=os.getenv("INITIAL_SUPERADMIN_USERNAME", "superadmin"),
        INITIAL_SUPERADMIN_PASSWORD=os.getenv("INITIAL_SUPERADMIN_PASSWORD", "SuperAdmin123!"),
        INITIAL_SUPERADMIN_EMAIL=os.getenv("INITIAL_SUPERADMIN_EMAIL", "superadmin@example.com"),
        INITIAL_SUPERADMIN_FULL_NAME=os.getenv("INITIAL_SUPERADMIN_FULL_NAME", "Super Admin"),
    )


settings = get_settings()