"""ecad-engine configuration: every setting from the environment, validated once at startup."""
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class AppConfig:
    port: int
    host: str
    environment: str
    cors_origins: list[str]
    max_file_size_bytes: int
    max_files: int
    rate_limit: str
    log_level: str

    @classmethod
    def from_env(cls) -> "AppConfig":
        environment = os.getenv("ENVIRONMENT", os.getenv("NODE_ENV", "development"))
        max_mb = int(os.getenv("ECAD_MAX_FILE_MB", "25"))
        max_files = int(os.getenv("ECAD_MAX_FILES", "40"))
        if not 1 <= max_mb <= 200:
            raise ValueError(f"ECAD_MAX_FILE_MB must be between 1 and 200, got {max_mb}")
        if not 1 <= max_files <= 200:
            raise ValueError(f"ECAD_MAX_FILES must be between 1 and 200, got {max_files}")
        origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:4000").split(",") if o.strip()]
        if environment == "production" and any(o == "*" for o in origins):
            raise ValueError("CORS_ORIGINS must not be * in production")
        level = os.getenv("LOG_LEVEL", "INFO").upper()
        if level not in ("DEBUG", "INFO", "WARNING", "ERROR"):
            raise ValueError(f"LOG_LEVEL must be DEBUG, INFO, WARNING or ERROR, got {level}")
        return cls(
            port=int(os.getenv("PORT", "5100")),
            host=os.getenv("HOST", "0.0.0.0"),
            environment=environment,
            cors_origins=origins,
            max_file_size_bytes=max_mb * 1024 * 1024,
            max_files=max_files,
            rate_limit=os.getenv("ECAD_RATE_LIMIT", "30/minute"),
            log_level=level,
        )
