"""
CAD Engine - STEP to STL Conversion Service

Professional implementation using OpenCascade (pythonocc-core)
Refactored with clean code principles, SOLID design, and security best practices

Author: mithran Platform
Standards: ISO 10303 (STEP), STL Binary Format
"""

import json
import os
import logging
import tempfile
import hashlib
import hmac
import uuid
from pathlib import Path
from typing import Dict, Any, List, Optional
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks, Request, Security, Form, Depends
from pydantic import BaseModel
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security.api_key import APIKeyHeader
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import uvicorn

from shared.config import AppConfig
from shared.services import StepReader, ShapeMesher, StlWriter, ConversionService
from shared.validators import FileValidator
from shared.analysis_gate import AnalysisGate
from shared.assembly_report import build_report, export_parts
from shared.part_analysis import ComponentFeatureCache, analyze_part
from shared.memory_optimizer import AdvancedCADMemoryOptimizer
from shared.exceptions import (
    CADEngineException,
    FileValidationError,
    ConversionError,
    StepReadError,
    UnknownPartError,
)
from shared import telemetry
from shared import sldprt_converter
from shared.drawing_analyzer import router as drawing_router

# ============================================================================
# CONFIGURATION & LOGGING
# ============================================================================

# Load configuration from environment
config = AppConfig.from_env()
config.validate()

# Configure logging
logging.basicConfig(
    level=getattr(logging, config.log_level),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

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
        _error_file.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
        logging.getLogger().addHandler(_error_file)
    except OSError as _e:
        logging.getLogger(__name__).warning(f"error log file disabled: {_e}")
logger = logging.getLogger(__name__)

# Log startup configuration (sanitized)
logger.info(f"Starting CAD Engine in {config.environment} mode")
logger.info(f"Port: {config.port}")
logger.info(f"Max file size: {config.max_file_size_bytes / (1024 * 1024):.2f}MB")
logger.info(f"Rate limit: {config.rate_limit_per_minute} requests/minute")
logger.info(f"CORS origins: {config.cors_origins}")

# ============================================================================
# RATE LIMITING
# ============================================================================

# Initialize rate limiter
limiter = Limiter(key_func=get_remote_address)

# ============================================================================
# APPLICATION LIFECYCLE
# ============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager - handles startup and shutdown"""
    
    # Startup
    logger.info("Initializing CAD Engine services...")

    # Create temp directory if it doesn't exist
    os.makedirs(config.temp_dir, exist_ok=True)
    logger.info(f"Temp directory: {config.temp_dir}")

    app.state.component_cache = ComponentFeatureCache(Path(config.temp_dir) / "cf_disk_cache")
    analysis_gate.start_watchdog()

    # Initialize services with dependency injection
    step_reader = StepReader()
    shape_mesher = ShapeMesher(
        linear_deflection=config.linear_deflection,
        angular_deflection=config.angular_deflection
    )
    stl_writer = StlWriter(ascii_mode=False)  # Binary STL for smaller files
    
    # Create conversion service
    conversion_service = ConversionService(
        step_reader=step_reader,
        shape_mesher=shape_mesher,
        stl_writer=stl_writer
    )
    
    # Create file validator
    file_validator = FileValidator(
        max_file_size_bytes=config.max_file_size_bytes
    )
    
    # Create advanced memory optimizer
    memory_optimizer = AdvancedCADMemoryOptimizer(
        cache_dir=config.temp_dir,
        max_memory_mb=2048
    )
    
    # Store in app state
    app.state.conversion_service = conversion_service
    app.state.file_validator = file_validator
    app.state.memory_optimizer = memory_optimizer
    app.state.config = config
    
    logger.info("CAD Engine services initialized successfully")
    
    yield
    
    # Shutdown
    logger.info("Shutting down CAD Engine...")
    telemetry.shutdown()  # bounded flush; a no-op when telemetry is off

# ============================================================================
# FASTAPI APPLICATION
# ============================================================================

app = FastAPI(
    title="mithran CAD Engine",
    description="Professional STEP to STL conversion service with security and rate limiting",
    version="2.0.0",
    lifespan=lifespan
)

# Add rate limiter to app state
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ============================================================================
# API KEY AUTHENTICATION
# ============================================================================

_CAD_API_KEY = os.getenv("CAD_ENGINE_API_KEY", "")
_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

async def require_api_key(api_key: str = Security(_api_key_header)):
    # Fail closed in every environment, as the ecad-engine does: an unset key refuses every protected route instead of opening
    # them. Local runs set CAD_ENGINE_API_KEY like any other deployment (docker-compose.yml requires it).
    if not _CAD_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="Service misconfigured: CAD_ENGINE_API_KEY is not set",
        )
    if not api_key or not hmac.compare_digest(api_key, _CAD_API_KEY):
        raise HTTPException(status_code=403, detail="Invalid or missing API key")

def _internal_error(operation: str) -> HTTPException:
    """A 500 for the exception being handled: the traceback goes to the log under a fresh error id, the caller gets only the
    id. Exception text can carry file paths, library internals or customer content, so it never goes into the response."""
    error_id = uuid.uuid4().hex
    logger.error("%s failed (error %s)", operation, error_id, exc_info=True)
    return HTTPException(status_code=500, detail=f"{operation} failed (error {error_id}).")


# 2D Drawing analysis (Groq vision + PyMuPDF PDF rendering)
app.include_router(drawing_router, prefix="/drawing", tags=["drawing"], dependencies=[Security(require_api_key)])

# ============================================================================
# MIDDLEWARE
# ============================================================================

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    max_age=3600,  # Cache preflight requests for 1 hour
)

# Off unless OTEL_EXPORTER_OTLP_ENDPOINT is set (see shared/telemetry.py). Continues an inbound traceparent from the backend.
telemetry.setup(app, service_name="mithran-cad-engine", environment=config.environment)

# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

def cleanup_files(*file_paths):
    """
    Background task to cleanup temporary files after response is sent
    """
    for file_path in file_paths:
        try:
            if file_path and os.path.exists(file_path):
                os.unlink(file_path)
                logger.info(f"Cleaned up temp file: {file_path}")
        except Exception as e:
            logger.warning(f"Cleanup error for {file_path}: {str(e)}")

# ============================================================================
# HEALTH & STATUS ENDPOINTS
# ============================================================================

@app.get("/")
async def root() -> Dict[str, Any]:
    """Root endpoint - service information"""
    return {
        "service": "mithran CAD Engine",
        "status": "running",
        "version": "2.0.0",
        "engine": "OpenCascade Technology (OCCT)",
        "environment": config.environment
    }


# Heavy OCC work runs in the threadpool (the handlers are plain `def`); the gate bounds how many run at once and
# restarts the process if one hangs (see shared/analysis_gate.py).
analysis_gate = AnalysisGate(config.max_concurrent_analyses, config.queue_wait_seconds, config.analysis_hard_limit_seconds)
analysis_slot = analysis_gate.slot
MAX_ASSEMBLY_FILES = 500



@app.get("/ready")
async def ready() -> JSONResponse:
    """Readiness: can this instance take work? 200, or 503 with reason codes only (the response is unauthenticated).

    /health stays a plain capability report. Backend readiness probes this route, so an instance with no API key
    (which refuses every protected route), or with an unwritable temp directory, is reported before it fails a real upload.
    """
    problems = []
    if not _CAD_API_KEY:
        problems.append("api_key_not_configured")
    if not (os.path.isdir(config.temp_dir) and os.access(config.temp_dir, os.W_OK)):
        problems.append("temp_dir_not_writable")
    return JSONResponse(status_code=503 if problems else 200, content={"ready": not problems, "problems": problems})


@app.get("/health")
async def health() -> Dict[str, Any]:
    """Detailed health check endpoint with advanced capabilities"""
    return {
        "status": "healthy",
        "opencascade": "pythonocc-core 7.7.2",
        "capabilities": [
            "STEP/IGES to STL Conversion",
            "Advanced Geometry Analysis", 
            "DFM Analysis with AI Insights",
            "Memory Optimization (50-80% reduction)",
            "Real-time Manufacturing Recommendations",
            "Intelligent Caching and LOD Generation"
        ],
        "limits": {
            "max_file_size_mb": config.max_file_size_bytes / (1024 * 1024),
            "rate_limit_per_minute": config.rate_limit_per_minute,
            "max_memory_mb": 2048,
            "max_concurrent_analyses": analysis_gate.max_concurrent,
            "analysis_hard_limit_seconds": config.analysis_hard_limit_seconds
        },
        "load": {
            "analyses_running": analysis_gate.running(),
            "oldest_analysis_seconds": round(analysis_gate.oldest_seconds(), 1)
        },
        "conversion_settings": {
            "linear_deflection": config.linear_deflection,
            "angular_deflection": config.angular_deflection
        },
        "advanced_features": {
            "memory_optimizer_version": "2.1.0",
            "dfm_standards": ["ISO 2768", "ASME Y14.5"],
            "optimization_strategies": ["aggressive", "balanced", "conservative"],
            "supported_processes": ["CNC Machining", "Investment Casting", "Sheet Metal", "Additive Manufacturing"]
        },
        "performance_targets": {
            "analysis_time_large_files": "< 10 seconds",
            "memory_reduction": "50-80%",
            "accuracy": "95%+",
            "cache_hit_rate": "> 85%"
        }
    }

# ============================================================================
# CONVERSION ENDPOINTS
# ============================================================================

@app.post("/convert/step-to-stl")
@limiter.limit(f"{config.rate_limit_per_minute}/minute")
async def convert_step_to_stl(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    _auth: None = Security(require_api_key)
) -> FileResponse:
    """
    Convert STEP file to STL with security validation
    
    Security features:
    - File size validation
    - File type validation (extension + magic number)
    - Rate limiting
    - Automatic cleanup
    
    Args:
        request: FastAPI request (for rate limiting)
        background_tasks: Background task manager
        file: Uploaded STEP/IGES file
        
    Returns:
        STL file (binary format)
        
    Raises:
        HTTPException: On validation or conversion errors
    """
    conversion_service: ConversionService = request.app.state.conversion_service
    file_validator: FileValidator = request.app.state.file_validator
    
    logger.info(f"Received conversion request: {file.filename} from {get_remote_address(request)}")
    
    step_path = None
    stl_path = None
    
    try:
        # Create temporary file for uploaded content
        file_ext = Path(file.filename).suffix.lower()
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext, dir=config.temp_dir, mode="wb") as temp_step:
            step_path = temp_step.name
            
            # Write uploaded file to temp location
            content = file.file.read()
            temp_step.write(content)  # type: ignore
            temp_step.flush()
        
        # Validate file (size, extension, magic number)
        try:
            validated_ext, file_size = file_validator.validate_file(step_path, file.filename)
            logger.info(f"File validated: {file.filename} ({file_size} bytes)")
        except FileValidationError as e:
            cleanup_files(step_path)
            logger.warning(f"File validation failed: {str(e)}")
            raise HTTPException(status_code=400, detail=str(e))
        
        # SolidWorks files need FreeCAD conversion to STEP before OpenCascade can read them
        if file_ext == '.sldprt':
            try:
                converted = sldprt_converter.convert(step_path, config.temp_dir)
                cleanup_files(step_path)
                step_path = converted
            except RuntimeError as e:
                cleanup_files(step_path)
                raise HTTPException(status_code=422, detail=str(e))

        # Create output STL path
        stl_path = str(Path(step_path).with_suffix('.stl'))

        # Convert STEP to STL
        try:
            output_path, stl_tri_count = conversion_service.convert(step_path, stl_path)
            logger.info(f"Conversion successful: {file.filename} → STL ({stl_tri_count} triangles)")
        except ConversionError as e:
            cleanup_files(step_path, stl_path)
            logger.error(f"Conversion failed: {str(e)}")
            raise HTTPException(
                status_code=422,
                detail=f"Conversion failed: {str(e)}"
            )

        # Schedule cleanup after response is sent
        background_tasks.add_task(cleanup_files, step_path, stl_path)

        # Return STL file — X-STL-Triangle-Count header used for face_map ordering verification:
        # compare this value to face_map_tri_total logged by /analyze/geometry.
        return FileResponse(
            output_path,
            media_type="application/octet-stream",
            filename=Path(file.filename).stem + ".stl",
            headers={
                "X-Original-Filename": file.filename,
                "X-Conversion-Engine": "OpenCascade",
                "X-File-Size": str(os.path.getsize(output_path)),
                "X-Mesh-Quality": f"linear={config.linear_deflection},angular={config.angular_deflection}",
                "X-STL-Triangle-Count": str(stl_tri_count),
            }
        )
    
    except HTTPException:
        raise
    except Exception as e:
        # Cleanup on unexpected error
        cleanup_files(step_path, stl_path)
        logger.error(f"Unexpected error: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Internal server error during conversion"
        )


@app.post("/convert/step-to-stl-base64")
@limiter.limit(f"{config.rate_limit_per_minute}/minute")
async def convert_step_to_stl_base64(
    request: Request,
    file: UploadFile = File(...),
    _auth: None = Security(require_api_key)
) -> Dict[str, Any]:
    """
    Convert STEP file to STL and return as base64
    
    Useful for direct embedding in responses or APIs
    
    Args:
        request: FastAPI request (for rate limiting)
        file: Uploaded STEP/IGES file
        
    Returns:
        JSON with base64-encoded STL data
        
    Raises:
        HTTPException: On validation or conversion errors
    """
    import base64
    
    conversion_service: ConversionService = request.app.state.conversion_service
    file_validator: FileValidator = request.app.state.file_validator
    
    logger.info(f"Received base64 conversion request: {file.filename}")
    
    step_path = None
    stl_path = None
    
    try:
        # Create temporary file
        file_ext = Path(file.filename).suffix.lower()
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext, dir=config.temp_dir, mode="wb") as temp_step:
            step_path = temp_step.name
            content = file.file.read()
            temp_step.write(content)  # type: ignore
            temp_step.flush()
        
        # Validate file
        try:
            validated_ext, file_size = file_validator.validate_file(step_path, file.filename)
        except FileValidationError as e:
            cleanup_files(step_path)
            raise HTTPException(status_code=400, detail=str(e))

        # SolidWorks files need FreeCAD conversion to STEP before OpenCascade can read them
        if file_ext == '.sldprt':
            try:
                converted = sldprt_converter.convert(step_path, config.temp_dir)
                cleanup_files(step_path)
                step_path = converted
            except RuntimeError as e:
                cleanup_files(step_path)
                raise HTTPException(status_code=422, detail=str(e))

        stl_path = str(Path(step_path).with_suffix('.stl'))

        # Convert
        try:
            output_path, stl_tri_count = conversion_service.convert(step_path, stl_path)
        except ConversionError as e:
            cleanup_files(step_path, stl_path)
            raise HTTPException(status_code=422, detail=f"Conversion failed: {str(e)}")

        # Read STL and encode to base64
        with open(output_path, 'rb') as f:
            stl_data = f.read()

        stl_base64 = base64.b64encode(stl_data).decode('utf-8')

        return {
            "success": True,
            "original_filename": file.filename,
            "stl_filename": Path(file.filename).stem + ".stl",
            "stl_size": len(stl_data),
            "stl_base64": stl_base64,
            "stl_tri_count": stl_tri_count,
            "mesh_quality": {
                "linear_deflection": config.linear_deflection,
                "angular_deflection": config.angular_deflection
            }
        }
    
    finally:
        # Always cleanup
        cleanup_files(step_path, stl_path)


# ============================================================================
# ADVANCED MEMORY OPTIMIZATION ENDPOINTS
# ============================================================================

@app.post("/analyze/geometry")
@limiter.limit(f"{config.rate_limit_per_minute}/minute")
def analyze_geometry_advanced(
    request: Request,
    file: UploadFile = File(...),
    strategy: str = Form("balanced"),
    force_reanalysis: bool = Form(False),
    user_processes: str = Form(""),
    family_hint: str = Form(""),
    _auth: None = Security(require_api_key),
    _slot: None = Depends(analysis_slot),
) -> Dict[str, Any]:
    """
    Advanced geometry analysis with DFM insights and memory optimization.

    Accepts optional `user_processes` as a JSON string — array of process objects
    from the calling application's process database. When provided, the AI DFM
    analysis will evaluate each process against the actual part geometry and rank
    them by suitability. Format: [{"processName":"CNC Milling","processCategory":"Machining",
    "machineType":"VMC","cycleTimeMinutes":45,"setupTimeMinutes":30}, ...]

    Accepts optional `family_hint` -- an explicit manual override (the
    Create BOM Item process dropdown). Pass one of shared.part_family's real
    platform families ("sheet_metal", "milled", "turned", "mill_turn",
    "plastic_molded", "die_cast") to force that family's extractor instead of
    the real geometric classifier chain -- this is the only way to reach
    "die_cast" today, since no automatic die-cast classifier exists yet
    (routing-adjacent inference, deliberately deferred). Any other value
    (including the default "") is ignored and the real classifier chain
    runs unchanged.
    """
    import json as _json

    memory_optimizer: AdvancedCADMemoryOptimizer = request.app.state.memory_optimizer
    file_validator: FileValidator = request.app.state.file_validator

    logger.info(f"Received advanced analysis request: {file.filename} with strategy: {strategy}")

    # Parse user_processes JSON if provided
    parsed_processes = []
    if user_processes:
        try:
            parsed_processes = _json.loads(user_processes)
            logger.info(f"Received {len(parsed_processes)} user processes for AI matching")
        except Exception as e:
            logger.warning(f"Failed to parse user_processes JSON: {e}")

    step_path = None

    try:
        file_ext = Path(file.filename).suffix.lower()
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext, dir=config.temp_dir, mode="wb") as temp_step:
            step_path = temp_step.name
            content = file.file.read()
            file_hash = hashlib.sha256(content).hexdigest()
            temp_step.write(content)
            temp_step.flush()

        try:
            validated_ext, file_size = file_validator.validate_file(step_path, file.filename)
            logger.info(f"File validated for analysis: {file.filename} ({file_size} bytes)")
        except FileValidationError as e:
            cleanup_files(step_path)
            raise HTTPException(status_code=400, detail=str(e))

        # SolidWorks files need FreeCAD conversion to STEP before OpenCascade can read them
        converted_path = None
        if file_ext == '.sldprt':
            try:
                converted_path = sldprt_converter.convert(step_path, config.temp_dir)
                cleanup_files(step_path)
                step_path = converted_path
                converted_path = None  # ownership transferred to step_path
            except RuntimeError as e:
                cleanup_files(step_path)
                raise HTTPException(status_code=422, detail=str(e))

        try:
            step_reader = StepReader()
            with telemetry.stage("step_load", expected=(StepReadError,)):
                shape = step_reader.read(step_path)
            logger.info("STEP file successfully read for analysis")
        except Exception as e:
            cleanup_files(step_path)
            raise HTTPException(status_code=422, detail=f"Failed to read STEP file: {str(e)}")

        try:
            response = analyze_part(
                shape=shape, step_path=step_path, filename=file.filename, file_hash=file_hash,
                memory_optimizer=memory_optimizer, component_cache=request.app.state.component_cache,
                face_graph_max_faces=config.face_graph_max_faces, strategy=strategy,
                force_reanalysis=force_reanalysis, user_processes=parsed_processes, family_hint=family_hint,
            )
            logger.info(f"Advanced analysis completed for {file.filename}")
            return response

        except Exception:
            cleanup_files(step_path)
            raise _internal_error("Analysis")

    finally:
        cleanup_files(step_path)


class NestHoleIn(BaseModel):
    cx_mm: float
    cy_mm: float
    diameter_mm: float


class NestRequest(BaseModel):
    # Real flat-pattern outline points from /analyze/geometry's
    # flat_pattern_outline_points_mm -- this endpoint does NOT re-parse a
    # CAD file; the caller already has the extracted geometry and is only
    # asking "how would this real shape pack onto this stock/quantity."
    outline_points_mm: list[list[float]]
    holes_mm: list[NestHoleIn] = []
    sheet_width_mm: float
    sheet_length_mm: float
    quantity: int
    kerf_mm: float = 0.0
    edge_margin_mm: float = 2.0
    allowed_rotations_deg: Optional[list[float]] = None


@app.post("/measure/geometry")
@limiter.limit(f"{config.rate_limit_per_minute}/minute")
def measure_geometry(
    request: Request,
    file: UploadFile = File(...),
    _auth: None = Security(require_api_key),
    _slot: None = Depends(analysis_slot),
) -> Dict[str, Any]:
    """
    The process-independent measurements of a solid only: volume (mm3),
    surface area (mm2) and the sorted bounding box (mm). No family
    classification and no feature extraction -- those need the part's process,
    which the Create BOM Item dialog asks for first. Same reader and the same
    measurement (shared/solid_measures.py) as /analyze/geometry.
    """
    from shared.solid_measures import measure_solid

    file_validator: FileValidator = request.app.state.file_validator
    step_path = None
    try:
        file_ext = Path(file.filename).suffix.lower()
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext, dir=config.temp_dir, mode="wb") as temp_step:
            step_path = temp_step.name
            temp_step.write(file.file.read())
            temp_step.flush()
        try:
            file_validator.validate_file(step_path, file.filename)
        except FileValidationError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if file_ext == '.sldprt':
            try:
                converted = sldprt_converter.convert(step_path, config.temp_dir)
            except RuntimeError as e:
                raise HTTPException(status_code=422, detail=str(e))
            cleanup_files(step_path)
            step_path = converted
        try:
            shape = StepReader().read(step_path)
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"Failed to read STEP file: {str(e)}")
        m = measure_solid(shape)
        return {
            "volume_mm3": round(float(m["volume"]), 4),
            "surface_area_mm2": round(float(m["surface_area"]), 4),
            "bounding_box": m["bounding_box"],
        }
    finally:
        if step_path:
            cleanup_files(step_path)


def _stage_step_uploads(request: Request, files: List[UploadFile], paths: List[str]) -> List[tuple]:
    """Writes the uploaded STEP files to temp files (their paths are appended to `paths` for cleanup) and validates them."""
    if len(files) > MAX_ASSEMBLY_FILES:
        raise HTTPException(status_code=400, detail=f"At most {MAX_ASSEMBLY_FILES} files per assembly")
    file_validator: FileValidator = request.app.state.file_validator
    named = []
    for upload in files:
        if Path(upload.filename).suffix.lower() not in (".step", ".stp"):
            raise HTTPException(status_code=400, detail=f"{upload.filename}: only STEP files are supported (export as STEP AP242)")
        with tempfile.NamedTemporaryFile(delete=False, suffix=".step", dir=config.temp_dir, mode="wb") as tmp:
            paths.append(tmp.name)
            tmp.write(upload.file.read())
        try:
            file_validator.validate_file(tmp.name, upload.filename)
        except FileValidationError as e:
            raise HTTPException(status_code=400, detail=str(e))
        named.append((upload.filename, tmp.name))
    return named


@app.post("/analyze/assembly")
@limiter.limit(f"{config.rate_limit_per_minute}/minute")
def analyze_assembly(
    request: Request,
    files: List[UploadFile] = File(...),
    _auth: None = Security(require_api_key),
    _slot: None = Depends(analysis_slot),
) -> Dict[str, Any]:
    """
    One product from one or more STEP files: the assembly tree (instances of the same part collapse into a quantity),
    and each distinct part measured once. Contract: contract/assembly.schema.json. A file that cannot be read makes
    the result `partial` instead of failing the call.
    """
    paths: List[str] = []
    try:
        named = _stage_step_uploads(request, files, paths)
        with telemetry.stage("assembly_analysis"):
            return build_report(named)
    finally:
        cleanup_files(*paths)


@app.post("/assembly/parts")
@limiter.limit(f"{config.rate_limit_per_minute}/minute")
def export_assembly_parts(
    request: Request,
    files: List[UploadFile] = File(...),
    parts: str = Form(..., description="JSON array of part ids from /analyze/assembly"),
    _auth: None = Security(require_api_key),
    _slot: None = Depends(analysis_slot),
) -> FileResponse:
    """
    A zip with one STEP file per requested part (`<id with ':' as '_'>.step`), so a part that exists only inside an
    assembly file can be stored and analysed on its own. Send the same files, in the same order, as to /analyze/assembly.
    """
    try:
        wanted = json.loads(parts)
    except ValueError:
        raise HTTPException(status_code=400, detail="parts must be a JSON array of part ids")
    if not isinstance(wanted, list) or not all(isinstance(p, str) for p in wanted) or not wanted:
        raise HTTPException(status_code=400, detail="parts must be a non-empty JSON array of part ids")
    paths: List[str] = []
    fd, zip_path = tempfile.mkstemp(suffix=".zip", dir=config.temp_dir)
    os.close(fd)
    try:
        named = _stage_step_uploads(request, files, paths)
        with telemetry.stage("assembly_analysis"):
            export_parts(named, wanted, zip_path, config.temp_dir)
    except UnknownPartError as e:
        cleanup_files(zip_path)
        raise HTTPException(status_code=400, detail=str(e))
    except BaseException:
        cleanup_files(zip_path)
        raise
    finally:
        cleanup_files(*paths)
    return FileResponse(zip_path, media_type="application/zip", filename="parts.zip", background=BackgroundTask(cleanup_files, zip_path))


@app.post("/nest")
@limiter.limit(f"{config.rate_limit_per_minute}/minute")
async def nest_true_shape(
    request: Request,
    body: NestRequest,
    _auth: None = Security(require_api_key),
) -> Dict[str, Any]:
    """
    True (real polygon) 2D nesting placement -- visualization only, NOT a
    material-cost source (see nesting.py's own module docstring for the
    full rationale). Deliberately separate from /analyze/geometry: this
    takes already-extracted outline/hole geometry as input rather than a
    CAD file, since sheet size/quantity/kerf/margin are order-time
    parameters, not CAD-static ones -- recomputing here is cheap and never
    needs the original file.
    """
    from sheet_metal import nesting

    logger.info(
        f"[nest] request: outline_points={len(body.outline_points_mm)} holes={len(body.holes_mm)} "
        f"sheet={body.sheet_width_mm}x{body.sheet_length_mm}mm qty={body.quantity} "
        f"kerf={body.kerf_mm}mm margin={body.edge_margin_mm}mm"
    )
    result, reason = nesting.compute_true_nest(
        outline_points_mm=body.outline_points_mm,
        holes_mm=[h.model_dump() for h in body.holes_mm],
        sheet_width_mm=body.sheet_width_mm,
        sheet_length_mm=body.sheet_length_mm,
        quantity=body.quantity,
        kerf_mm=body.kerf_mm,
        edge_margin_mm=body.edge_margin_mm,
        allowed_rotations_deg=body.allowed_rotations_deg,
    )
    if result is None:
        # Real, disclosed failure (degenerate/oversized outline, or the
        # sheet's usable area is non-positive) -- never a fabricated layout.
        logger.warning(f"[nest] failed: {reason}")
        raise HTTPException(status_code=422, detail=f"Could not compute a true nest: {reason}")
    logger.info(f"[nest] success: parts_per_sheet={result['parts_per_sheet']} utilization_pct={result['utilization_pct']} capped={result['capped']}")
    return result


@app.get("/memory/usage-report")
async def get_memory_usage_report(
    request: Request,
    _auth: None = Security(require_api_key),
) -> Dict[str, Any]:
    """
    Get comprehensive memory usage and performance report
    
    Returns detailed statistics about:
    - Current memory utilization
    - Cache performance metrics  
    - Optimization statistics
    - Active processing tasks
    """
    memory_optimizer: AdvancedCADMemoryOptimizer = request.app.state.memory_optimizer
    
    try:
        report = memory_optimizer.get_memory_usage_report()
        
        return {
            "success": True,
            "service_info": {
                "version": memory_optimizer.VERSION,
                "capabilities": [
                    "Advanced Geometry Analysis",
                    "DFM Analysis with AI Insights", 
                    "Memory Optimization (50-80% reduction)",
                    "Real-time Manufacturing Recommendations",
                    "Intelligent Caching and LOD Generation"
                ]
            },
            "memory_report": report
        }
        
    except Exception as e:
        logger.error(f"Failed to generate memory report: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate memory usage report")


@app.post("/optimize/memory")
@limiter.limit(f"{config.rate_limit_per_minute}/minute") 
async def optimize_memory_only(
    request: Request,
    file: UploadFile = File(...),
    strategy: str = Form("balanced"),
    _auth: None = Security(require_api_key),
) -> Dict[str, Any]:
    """
    Memory-focused optimization without full DFM analysis
    
    Faster endpoint optimized for memory reduction scenarios where
    detailed DFM analysis is not required.
    
    Args:
        request: FastAPI request
        file: STEP/IGES file to optimize
        strategy: Optimization strategy (aggressive/balanced/conservative)
        
    Returns:
        Memory optimization metrics and recommendations
    """
    memory_optimizer: AdvancedCADMemoryOptimizer = request.app.state.memory_optimizer
    file_validator: FileValidator = request.app.state.file_validator
    
    logger.info(f"Received memory optimization request: {file.filename}")
    
    step_path = None
    
    try:
        # Process file similar to analysis endpoint but focus on memory optimization
        file_ext = Path(file.filename).suffix.lower()
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext, dir=config.temp_dir, mode="wb") as temp_step:
            step_path = temp_step.name
            content = file.file.read()
            file_hash = hashlib.sha256(content).hexdigest()
            temp_step.write(content)
            temp_step.flush()
        
        # Validate file
        validated_ext, file_size = file_validator.validate_file(step_path, file.filename)
        
        # Read STEP file
        step_reader = StepReader()
        shape = step_reader.read(step_path)
        
        optimization_result = memory_optimizer.analyze_and_optimize(
            shape=shape,
            file_path=step_path,
            strategy=strategy,
            force_reanalysis=False,
            file_hash=file_hash
        )
        
        return {
            "success": True,
            "original_filename": file.filename,
            "optimization_strategy": strategy,
            "memory_optimization": {
                "original_size_kb": optimization_result.memory_metrics.original_size_kb,
                "optimized_size_kb": optimization_result.memory_metrics.optimized_size_kb,
                "memory_reduction_percent": optimization_result.memory_metrics.memory_reduction_percent,
                "compression_ratio": optimization_result.memory_metrics.compression_ratio,
                "processing_time_ms": optimization_result.memory_metrics.processing_time_ms
            },
            "performance": {
                "lod_levels_generated": optimization_result.lod_levels_generated,
                "cache_efficiency": optimization_result.memory_metrics.cache_efficiency
            },
            "recommendations": optimization_result.recommendations
        }
        
    except FileValidationError as e:
        cleanup_files(step_path)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        cleanup_files(step_path)
        raise _internal_error("Memory optimization")
    finally:
        cleanup_files(step_path)


# ============================================================================
# ERROR HANDLERS
# ============================================================================

@app.exception_handler(CADEngineException)
async def cad_engine_exception_handler(request: Request, exc: CADEngineException):
    """Handle CAD engine specific exceptions"""
    logger.error(f"CAD Engine error: {str(exc)}")
    return JSONResponse(
        status_code=422,
        content={
            "error": "CAD Engine Error",
            "detail": str(exc),
            "type": exc.__class__.__name__
        }
    )

# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    logger.info(f"Starting CAD Engine on {config.host}:{config.port}")
    
    uvicorn.run(
        "main:app",
        host=config.host,
        port=config.port,
        reload=False,
        log_level=config.log_level.lower(),
        access_log=True
    )
