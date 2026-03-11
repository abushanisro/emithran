"""
CAD Engine - STEP to STL Conversion Service

Professional implementation using OpenCascade (pythonocc-core)
Refactored with clean code principles, SOLID design, and security best practices

Author: mithran Platform
Standards: ISO 10303 (STEP), STL Binary Format
"""

import os
import logging
import tempfile
import hashlib
from pathlib import Path
from typing import Dict, Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import uvicorn

from config import AppConfig
from services import StepReader, ShapeMesher, StlWriter, ConversionService
from validators import FileValidator
from memory_optimizer import AdvancedCADMemoryOptimizer, OptimizationResult
from exceptions import (
    CADEngineException,
    FileValidationError,
    ConversionError
)

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
    # Cleanup if needed

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
            "max_concurrent_analyses": 50
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
    file: UploadFile = File(...)
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
            content = await file.read()
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
        
        # Create output STL path
        stl_path = str(Path(step_path).with_suffix('.stl'))
        
        # Convert STEP to STL
        try:
            output_path = conversion_service.convert(step_path, stl_path)
            logger.info(f"Conversion successful: {file.filename} → STL")
        except ConversionError as e:
            cleanup_files(step_path, stl_path)
            logger.error(f"Conversion failed: {str(e)}")
            raise HTTPException(
                status_code=422,
                detail=f"Conversion failed: {str(e)}"
            )
        
        # Schedule cleanup after response is sent
        background_tasks.add_task(cleanup_files, step_path, stl_path)
        
        # Return STL file
        return FileResponse(
            output_path,
            media_type="application/octet-stream",
            filename=Path(file.filename).stem + ".stl",
            headers={
                "X-Original-Filename": file.filename,
                "X-Conversion-Engine": "OpenCascade",
                "X-File-Size": str(os.path.getsize(output_path)),
                "X-Mesh-Quality": f"linear={config.linear_deflection},angular={config.angular_deflection}"
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
    file: UploadFile = File(...)
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
            content = await file.read()
            temp_step.write(content)  # type: ignore
            temp_step.flush()
        
        # Validate file
        try:
            validated_ext, file_size = file_validator.validate_file(step_path, file.filename)
        except FileValidationError as e:
            cleanup_files(step_path)
            raise HTTPException(status_code=400, detail=str(e))
        
        stl_path = str(Path(step_path).with_suffix('.stl'))
        
        # Convert
        try:
            output_path = conversion_service.convert(step_path, stl_path)
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
            "mesh_quality": {
                "linear_deflection": config.linear_deflection,
                "angular_deflection": config.angular_deflection
            }
        }
    
    finally:
        # Always cleanup
        cleanup_files(step_path, stl_path)
        
    raise RuntimeError("Unreachable")


# ============================================================================
# ADVANCED MEMORY OPTIMIZATION ENDPOINTS 
# ============================================================================

@app.post("/analyze/geometry")
@limiter.limit(f"{config.rate_limit_per_minute}/minute")
async def analyze_geometry_advanced(
    request: Request,
    file: UploadFile = File(...),
    strategy: str = "balanced",
    force_reanalysis: bool = False,
    user_processes: str = ""   # JSON string: array of process objects from user's process API
) -> Dict[str, Any]:
    """
    Advanced geometry analysis with DFM insights and memory optimization.

    Accepts optional `user_processes` as a JSON string — array of process objects
    from the calling application's process database. When provided, the AI DFM
    analysis will evaluate each process against the actual part geometry and rank
    them by suitability. Format: [{"processName":"CNC Milling","processCategory":"Machining",
    "machineType":"VMC","cycleTimeMinutes":45,"setupTimeMinutes":30}, ...]
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
            content = await file.read()
            file_hash = hashlib.sha256(content).hexdigest()
            temp_step.write(content)
            temp_step.flush()

        try:
            validated_ext, file_size = file_validator.validate_file(step_path, file.filename)
            logger.info(f"File validated for analysis: {file.filename} ({file_size} bytes)")
        except FileValidationError as e:
            cleanup_files(step_path)
            raise HTTPException(status_code=400, detail=str(e))

        try:
            step_reader = StepReader()
            shape = step_reader.read(step_path)
            logger.info("STEP file successfully read for analysis")
        except Exception as e:
            cleanup_files(step_path)
            raise HTTPException(status_code=422, detail=f"Failed to read STEP file: {str(e)}")

        try:
            optimization_result = memory_optimizer.analyze_and_optimize(
                shape=shape,
                file_path=step_path,
                strategy=strategy,
                force_reanalysis=force_reanalysis,
                user_processes=parsed_processes,
                file_hash=file_hash
            )

            logger.info(f"Advanced analysis completed for {file.filename}")

            ai_enhanced_result = getattr(optimization_result.dfm_analysis, '_ai_enhanced_result', None)

            response = {
                "success": True,
                "analysis_id": optimization_result.geometry_hash[:16],
                "original_filename": file.filename,
                "optimization_strategy": optimization_result.optimization_strategy,
                "model_version": optimization_result.model_version,
                "timestamp": optimization_result.timestamp.isoformat(),

                "geometry_features": {
                    "volume_mm3": optimization_result.geometry_features.volume,
                    "surface_area_mm2": optimization_result.geometry_features.surface_area,
                    "bounding_box": optimization_result.geometry_features.bounding_box,
                    "complexity_score": optimization_result.geometry_features.complexity_score,
                    "feature_count": optimization_result.geometry_features.feature_count,
                    "manufacturing_features": optimization_result.geometry_features.manufacturing_features,
                    "mass_properties": optimization_result.geometry_features.mass_properties
                },

                "memory_optimization": {
                    "original_size_kb": optimization_result.memory_metrics.original_size_kb,
                    "optimized_size_kb": optimization_result.memory_metrics.optimized_size_kb,
                    "compression_ratio": optimization_result.memory_metrics.compression_ratio,
                    "memory_reduction_percent": optimization_result.memory_metrics.memory_reduction_percent,
                    "processing_time_ms": optimization_result.memory_metrics.processing_time_ms,
                    "cache_efficiency": optimization_result.memory_metrics.cache_efficiency
                },

                "dfm_analysis": {
                    "manufacturability_score": optimization_result.dfm_analysis.manufacturability_score,
                    "difficulty_level": optimization_result.dfm_analysis.difficulty_level,
                    "recommended_processes": optimization_result.dfm_analysis.recommended_processes,
                    "warnings": optimization_result.dfm_analysis.warnings,
                    "confidence": optimization_result.dfm_analysis.confidence,
                    "ai_enhanced": ai_enhanced_result is not None,
                    "ai_insights": {
                        "manufacturing_complexity": ai_enhanced_result.ai_insights.manufacturing_complexity if ai_enhanced_result and ai_enhanced_result.ai_insights else None,
                        "process_recommendations": ai_enhanced_result.ai_insights.process_recommendations if ai_enhanced_result and ai_enhanced_result.ai_insights else [],
                        "cost_optimization_suggestions": ai_enhanced_result.ai_insights.cost_optimization_suggestions if ai_enhanced_result and ai_enhanced_result.ai_insights else [],
                        "quality_considerations": ai_enhanced_result.ai_insights.quality_considerations if ai_enhanced_result and ai_enhanced_result.ai_insights else [],
                        "material_recommendations": ai_enhanced_result.ai_insights.material_recommendations if ai_enhanced_result and ai_enhanced_result.ai_insights else [],
                        "tooling_requirements": ai_enhanced_result.ai_insights.tooling_requirements if ai_enhanced_result and ai_enhanced_result.ai_insights else {},
                        "lead_time_estimate_days": ai_enhanced_result.ai_insights.lead_time_estimate_days if ai_enhanced_result and ai_enhanced_result.ai_insights else None,
                        "risk_assessment": ai_enhanced_result.ai_insights.risk_assessment if ai_enhanced_result and ai_enhanced_result.ai_insights else {},
                        "ai_confidence": ai_enhanced_result.ai_insights.ai_confidence if ai_enhanced_result and ai_enhanced_result.ai_insights else 0.0,
                        "generation_time_ms": ai_enhanced_result.ai_insights.generation_time_ms if ai_enhanced_result and ai_enhanced_result.ai_insights else None,
                        # New fields from enhanced prompt
                        "dfm_warnings": getattr(ai_enhanced_result.ai_insights, 'dfm_warnings', []) if ai_enhanced_result and ai_enhanced_result.ai_insights else []
                    },
                    "detailed_recommendations": ai_enhanced_result.detailed_recommendations if ai_enhanced_result else [],
                    "competitive_analysis": ai_enhanced_result.competitive_analysis if ai_enhanced_result else {},
                    "sustainability_metrics": ai_enhanced_result.sustainability_metrics if ai_enhanced_result else {}
                },

                "performance_metrics": {
                    "lod_levels_generated": optimization_result.lod_levels_generated,
                    "recommendations": optimization_result.recommendations
                }
            }

            return response

        except Exception as e:
            cleanup_files(step_path)
            logger.error(f"Advanced analysis failed: {str(e)}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

    finally:
        cleanup_files(step_path)
        
    raise RuntimeError("Unreachable")


@app.get("/memory/usage-report")
async def get_memory_usage_report(request: Request) -> Dict[str, Any]:
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
    strategy: str = "balanced"
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
    conversion_service: ConversionService = request.app.state.conversion_service
    file_validator: FileValidator = request.app.state.file_validator
    
    logger.info(f"Received memory optimization request: {file.filename}")
    
    step_path = None
    
    try:
        # Process file similar to analysis endpoint but focus on memory optimization
        file_ext = Path(file.filename).suffix.lower()
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext, dir=config.temp_dir, mode="wb") as temp_step:
            step_path = temp_step.name
            content = await file.read()
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
    except Exception as e:
        cleanup_files(step_path)
        logger.error(f"Memory optimization failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Memory optimization failed: {str(e)}")
    finally:
        cleanup_files(step_path)
        
    raise RuntimeError("Unreachable")


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
        reload=(config.environment == "production"),
        log_level=config.log_level.lower(),
        access_log=True
    )
