from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    APP_NAME: str = "cisco-service"
    ENVIRONMENT: str = "dev"
    LOG_LEVEL: str = "INFO"

    DB_URL: str = "sqlite:///./cisco.db"

    JWT_SECRET_KEY: str = ""
    JWT_ALGORITHM: str = "HS256"

    AUTH_SERVICE_URL: str = "http://localhost:9000"

    CISCO_BASE_URL: str = ""
    CISCO_USERNAME: str = ""
    CISCO_PASSWORD: str = ""

    class Config:
        env_file = ".env"


settings = Settings()