from pathlib import Path
from pydantic_settings import BaseSettings

# .env file resolution:
# - Docker: mounted at /app/.env (via docker-compose volume)
# - Local dev: at project root (parents[3] from this file)
_LOCAL_ENV = Path(__file__).resolve().parents[3] / ".env"
_DOCKER_ENV = Path("/app/.env")
_ENV_FILE = str(_DOCKER_ENV) if _DOCKER_ENV.exists() else str(_LOCAL_ENV)


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # MinIO / Object Storage
    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: str = "minioadmin"

    # JWT
    JWT_SECRET_KEY: str = "dev-secret-change-me"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 480

    # AI
    CONFIDENCE_THRESHOLD: float = 0.6
    LIVENESS_THRESHOLD: float = 0.8
    MODELS_DIR: str = ""  # Set in .env or docker-compose; empty = use code fallback

    class Config:
        env_file = str(_ENV_FILE)
        env_file_encoding = "utf-8"


settings = Settings()
