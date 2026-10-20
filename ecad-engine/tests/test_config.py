"""Startup configuration is validated once; a bad value stops the service rather than running with a surprise."""
import pytest

from config import AppConfig


def test_defaults(monkeypatch):
    for name in ("ECAD_MAX_FILE_MB", "ECAD_MAX_FILES", "CORS_ORIGINS", "LOG_LEVEL", "ENVIRONMENT", "NODE_ENV", "PORT", "ECAD_RATE_LIMIT"):
        monkeypatch.delenv(name, raising=False)
    config = AppConfig.from_env()
    assert (config.port, config.environment, config.max_file_size_bytes, config.max_files) == (5100, "development", 25 * 1024 * 1024, 40)
    assert config.cors_origins == ["http://localhost:3000", "http://localhost:4000"] and config.log_level == "INFO"


def test_values_come_from_the_environment(monkeypatch):
    monkeypatch.setenv("ECAD_MAX_FILE_MB", "10")
    monkeypatch.setenv("CORS_ORIGINS", "https://a.example, https://b.example")
    monkeypatch.setenv("LOG_LEVEL", "debug")
    config = AppConfig.from_env()
    assert config.max_file_size_bytes == 10 * 1024 * 1024 and config.cors_origins == ["https://a.example", "https://b.example"] and config.log_level == "DEBUG"


@pytest.mark.parametrize(
    "name,value,message",
    [("ECAD_MAX_FILE_MB", "0", "ECAD_MAX_FILE_MB"), ("ECAD_MAX_FILE_MB", "500", "ECAD_MAX_FILE_MB"), ("ECAD_MAX_FILES", "0", "ECAD_MAX_FILES"), ("LOG_LEVEL", "LOUD", "LOG_LEVEL")],
)
def test_out_of_range_values_stop_startup(monkeypatch, name, value, message):
    monkeypatch.setenv(name, value)
    with pytest.raises(ValueError, match=message):
        AppConfig.from_env()


def test_production_refuses_a_wildcard_origin(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("CORS_ORIGINS", "*")
    with pytest.raises(ValueError, match="CORS_ORIGINS"):
        AppConfig.from_env()
