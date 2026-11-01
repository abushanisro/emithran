"""ecad-engine: electronics design-file extraction service.

Reads a customer board set (Gerber layers, drill file, drill report, Pick Place, BOM workbook) and returns a candidate
board feature graph with per-field provenance and cross-check findings, or a layered SVG preview of the board. It holds no
lookup data of its own: file roles, placement layer names and footprint classes arrive with each request, from the platform
tables in memory/Electronics. Customer files are never logged (counts only).

Endpoints
  GET  /          service information
  GET  /health    capabilities, limits, library versions (no key needed, nothing sensitive)
  GET  /ready     200 only when the service can authenticate requests (API key configured)
  POST /extract/board   multipart files + JSON manifest -> feature graph, documents, file report
  POST /render/board    multipart files + JSON manifest -> layered SVG preview on one shared frame
"""
import hmac
import importlib.metadata
import json
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Request, Security, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security.api_key import APIKeyHeader
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

import telemetry
from config import AppConfig
from extraction.board import (
    CONTRACT_VERSION,
    PARSER_ID,
    PARSER_VERSION,
    ExtractionError,
    InputFile,
    Lookups,
    PackageEntry,
    Supplied,
    extract_board,
)
from extraction.render import DRAWN_ROLES, render_board

config = AppConfig.from_env()
logging.basicConfig(level=getattr(logging, config.log_level), format="%(asctime)s %(levelname)s %(name)s %(message)s")

# Errors only are kept, in a daily file deleted after 15 days -- never in a
# database. ERROR_LOG_DIR (default "logs"); ERROR_LOG_FILE=false turns it off.
if os.getenv("ERROR_LOG_FILE", "true").lower() != "false":
    import logging.handlers
    _error_log_dir = os.getenv("ERROR_LOG_DIR", "logs")
    try:
        os.makedirs(_error_log_dir, exist_ok=True)
        _error_file = logging.handlers.TimedRotatingFileHandler(
            os.path.join(_error_log_dir, "error.log"), when="midnight", backupCount=15, encoding="utf-8",
        )
        _error_file.setLevel(logging.ERROR)
        _error_file.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
        logging.getLogger().addHandler(_error_file)
    except OSError as _e:
        logging.getLogger(__name__).warning(f"error log file disabled: {_e}")
log = logging.getLogger("ecad-engine")

SERVICE_VERSION = "0.2.0"
MAX_FILE_BYTES = config.max_file_size_bytes
MAX_FILES = config.max_files
STARTED_AT = time.time()

limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info(
        "ecad-engine %s starting (environment=%s, max %d MB per file, %d files)",
        SERVICE_VERSION,
        config.environment,
        MAX_FILE_BYTES // (1024 * 1024),
        MAX_FILES,
    )
    if not os.getenv("ECAD_ENGINE_API_KEY"):
        log.warning("ECAD_ENGINE_API_KEY is not set: every request except /health and /ready is refused until it is")
    app.state.config = config
    yield
    log.info("ecad-engine shutting down")
    telemetry.shutdown()  # bounded flush; a no-op when telemetry is off


app = FastAPI(
    title="mithran ecad-engine",
    description="Extracts measured board features from Gerber, drill and Pick Place files, with provenance",
    version=SERVICE_VERSION,
    lifespan=lifespan,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    max_age=3600,
)
# Off unless OTEL_EXPORTER_OTLP_ENDPOINT is set (see telemetry.py). Continues an inbound traceparent from the backend.
telemetry.setup(app, service_name="mithran-ecad-engine", environment=config.environment)


@app.middleware("http")
async def request_id(request: Request, call_next):
    """Every response carries an X-Request-ID (the caller's, or a new one) so a request can be followed through the logs."""
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex
    request.state.request_id = rid
    response = await call_next(request)
    response.headers["X-Request-ID"] = rid
    return response


@app.exception_handler(Exception)
async def unexpected_error(request: Request, error: Exception) -> JSONResponse:
    """An unexpected failure is a 500 with a code and the request id: never a traceback, never file content."""
    rid = getattr(request.state, "request_id", "-")
    log.error("unhandled %s on %s (request %s)", type(error).__name__, request.url.path, rid)
    return JSONResponse(status_code=500, content={"code": "internal_error", "message": "The engine failed on this request.", "requestId": rid})


_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def _api_key() -> str:
    return os.getenv("ECAD_ENGINE_API_KEY", "")


def require_key(api_key: str | None = Security(_key_header)) -> None:
    expected = _api_key()
    if not expected:
        raise HTTPException(status_code=503, detail="Service misconfigured: ECAD_ENGINE_API_KEY is not set")
    if not api_key or not hmac.compare_digest(api_key, expected):
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


def _version(package: str) -> str:
    try:
        return importlib.metadata.version(package)
    except importlib.metadata.PackageNotFoundError:
        return "unknown"


@app.get("/")
def root() -> dict[str, Any]:
    return {"service": "mithran ecad-engine", "status": "running", "version": SERVICE_VERSION, "environment": config.environment}


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "version": SERVICE_VERSION,
        "uptimeSeconds": round(time.time() - STARTED_AT),
        "contractVersion": CONTRACT_VERSION,
        "extractor": {"id": PARSER_ID, "version": PARSER_VERSION},
        "libraries": {"gerbonara": _version("gerbonara"), "openpyxl": _version("openpyxl"), "fastapi": _version("fastapi")},
        "capabilities": [
            "Board outline size and enclosed area (panels of several regions)",
            "Copper layer count",
            "Drilled holes by diameter and plating, cross-checked against the drill report",
            "Solder paste opening area per side",
            "Placements by side and footprint (Pick Place CSV or workbook)",
            "Nets traced through the copper layers and plated holes; parts tied to them through their copper pins",
            "Series chains of two-pin parts (for example LED strings and their ballast resistors)",
            "Through-hole or surface-mount, and pins per part, read from the copper and drill file for unlisted footprints",
            "Narrowest spacing between conductors, smallest annular ring, copper nearest the board edge",
            "Copper area per side and vias",
            "Layered SVG board preview, with the parts (Pick Place) and drilled holes positioned on the same frame",
        ],
        "renderedRoles": list(DRAWN_ROLES),
        "limits": {"maxFileSizeMb": MAX_FILE_BYTES // (1024 * 1024), "maxFiles": MAX_FILES, "rateLimit": config.rate_limit},
    }


@app.get("/ready")
def ready() -> JSONResponse:
    configured = bool(_api_key())
    return JSONResponse(
        status_code=200 if configured else 503,
        content={"ready": configured, "reason": None if configured else "ECAD_ENGINE_API_KEY is not set"},
    )


def _bad(code: str, message: str, status: int = 422) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "message": message})


def _refused(code: str, message: str, request: Request) -> JSONResponse:
    """A 422 for the exception being handled. Its text (library internals, file content) goes only to the log, with the
    traceback, under a fresh error id; the caller gets the code, a fixed message and that id."""
    error_id = uuid.uuid4().hex
    log.warning("%s (error %s, request %s)", code, error_id, getattr(request.state, "request_id", "-"), exc_info=True)
    return JSONResponse(status_code=422, content={"code": code, "message": f"{message} (error {error_id})", "errorId": error_id})


def _parse_manifest(raw: str) -> tuple[list[dict[str, Any]], Lookups, dict[str, Supplied], str]:
    manifest = json.loads(raw)
    files = manifest["files"]
    lookups_in = manifest.get("lookups", {})
    lookups = Lookups(
        placement_layers={str(k).lower(): str(v) for k, v in lookups_in.get("placementLayers", {}).items()},
        packages={
            name: PackageEntry(entry.get("packageClass"), entry["mountType"], entry.get("pinCount"))
            for name, entry in lookups_in.get("packages", {}).items()
        },
    )
    supplied = {key: Supplied(item["value"], item["note"]) for key, item in manifest.get("supplied", {}).items()}
    return files, lookups, supplied, manifest.get("inputTier", "B")


async def _read_files(files: list[UploadFile], roles: dict[str, str | None]) -> list[InputFile] | JSONResponse:
    if len(files) > MAX_FILES:
        return _bad("too_many_files", f"at most {MAX_FILES} files per request", 413)
    inputs: list[InputFile] = []
    for upload in files:
        data = await upload.read(MAX_FILE_BYTES + 1)
        if len(data) > MAX_FILE_BYTES:
            return _bad("file_too_large", f"{upload.filename} exceeds {MAX_FILE_BYTES // (1024 * 1024)} MB", 413)
        if upload.filename not in roles:
            return _bad("invalid_manifest", f"{upload.filename} is not described in the manifest")
        inputs.append(InputFile(upload.filename, data, roles[upload.filename]))
    return inputs


@app.post("/extract/board", dependencies=[Security(require_key)])
@limiter.limit(config.rate_limit)
async def extract(request: Request, files: list[UploadFile] = File(...), manifest: str = Form(...)) -> JSONResponse:
    try:
        described, lookups, supplied, tier = _parse_manifest(manifest)
    except (ValueError, KeyError, TypeError) as error:
        return _bad("invalid_manifest", f"manifest not understood: {type(error).__name__}")
    inputs = await _read_files(files, {item["name"]: item.get("role") for item in described})
    if isinstance(inputs, JSONResponse):
        return inputs
    started = time.perf_counter()
    try:
        # A refusal of the files (ExtractionError, unreadable file) is an outcome "rejected", not a failure.
        with telemetry.stage("extract_board", expected=(ExtractionError, ValueError)):
            result = extract_board(inputs, lookups, supplied, tier)
    except ExtractionError:
        return _refused("extraction_failed", "The board files could not be extracted.", request)
    except ValueError:  # a file that cannot be read
        return _refused("unreadable_file", "A board file could not be read.", request)
    log.info("extracted a board set of %d files in %.2fs (request %s)", len(inputs), time.perf_counter() - started, request.state.request_id)
    return JSONResponse(content={"graph": result.graph, "documents": result.documents, "filesReport": result.files_report})


@app.post("/render/board", dependencies=[Security(require_key)])
@limiter.limit(config.rate_limit)
async def render(request: Request, files: list[UploadFile] = File(...), manifest: str = Form(...)) -> JSONResponse:
    try:
        described, lookups, _supplied, _tier = _parse_manifest(manifest)
        roles = {item["name"]: item.get("role") for item in described}
    except (ValueError, KeyError, TypeError) as error:
        return _bad("invalid_manifest", f"manifest not understood: {type(error).__name__}")
    inputs = await _read_files(files, roles)
    if isinstance(inputs, JSONResponse):
        return inputs
    started = time.perf_counter()
    try:
        with telemetry.stage("render_board", expected=(ExtractionError, ValueError)):
            preview = render_board(inputs, lookups.placement_layers)
    except ExtractionError:
        return _refused("render_failed", "The board layers could not be drawn.", request)
    log.info("rendered %d layers in %.2fs (request %s)", len(preview["layers"]), time.perf_counter() - started, request.state.request_id)
    return JSONResponse(content=preview)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=config.host, port=config.port, log_level=config.log_level.lower())
