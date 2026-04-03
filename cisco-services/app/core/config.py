import os
from dotenv import load_dotenv
from pydantic import BaseModel, Field

load_dotenv()


class Settings(BaseModel):
    APP_NAME: str = Field(default="cisco-service")
    ENVIRONMENT: str = Field(default="dev")
    LOG_LEVEL: str = Field(default="INFO")

    DB_URL: str = Field(default="sqlite:///./cisco.db")

    JWT_SECRET_KEY: str = Field(default="change_this_super_secret_key")
    JWT_ALGORITHM: str = Field(default="HS256")

    AUTH_SERVICE_URL: str = Field(default="http://127.0.0.1:9000")

    CISCO_CONNECTION_TIMEOUT: int = Field(default=15)
    CISCO_COMMAND_TIMEOUT: int = Field(default=30)


def get_settings() -> Settings:
    return Settings(
        APP_NAME=os.getenv("APP_NAME", "cisco-service"),
        ENVIRONMENT=os.getenv("ENVIRONMENT", "dev"),
        LOG_LEVEL=os.getenv("LOG_LEVEL", "INFO"),
        DB_URL=os.getenv("DB_URL", "sqlite:///./cisco.db"),
        JWT_SECRET_KEY=os.getenv("JWT_SECRET_KEY", "change_this_super_secret_key"),
        JWT_ALGORITHM=os.getenv("JWT_ALGORITHM", "HS256"),
        AUTH_SERVICE_URL=os.getenv("AUTH_SERVICE_URL", "http://127.0.0.1:9000"),
        CISCO_CONNECTION_TIMEOUT=int(os.getenv("CISCO_CONNECTION_TIMEOUT", "15")),
        CISCO_COMMAND_TIMEOUT=int(os.getenv("CISCO_COMMAND_TIMEOUT", "30")),
    )


settings = get_settings()