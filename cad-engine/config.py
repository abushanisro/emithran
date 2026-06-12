"""
CAD Engine Configuration Management

Centralized configuration with environment variable validation
"""

import os
from dataclasses import dataclass
from typing import List


@dataclass
class AppConfig:
    """Application configuration loaded from environment variables"""
    
    # Server
    port: int
    host: str
    environment: str
    
    # Security
    cors_origins: List[str]
    max_file_size_bytes: int
    rate_limit_per_minute: int
    
    # Conversion settings
    linear_deflection: float
    angular_deflection: float
    
    # Storage
    temp_dir: str
    
    # Logging
    log_level: str
    
    @classmethod
    def from_env(cls) -> 'AppConfig':
        """Load configuration from environment variables with validation"""
        
        # Parse CORS origins
        cors_origins_str = os.getenv("CORS_ORIGINS", "http://localhost:3000")
        cors_origins = [origin.strip() for origin in cors_origins_str.split(",")]
        
        # Parse file size (convert MB to bytes)
        max_file_size_mb = int(os.getenv("MAX_FILE_SIZE_MB", "50"))
        max_file_size_bytes = max_file_size_mb * 1024 * 1024
        
        # Parse conversion settings
        linear_deflection = float(os.getenv("LINEAR_DEFLECTION", "0.1"))
        angular_deflection = float(os.getenv("ANGULAR_DEFLECTION", "0.5"))
        
        # Validate deflection values
        if not (0.001 <= linear_deflection <= 1.0):
            raise ValueError(f"LINEAR_DEFLECTION must be between 0.001 and 1.0, got {linear_deflection}")
        
        if not (0.1 <= angular_deflection <= 1.0):
            raise ValueError(f"ANGULAR_DEFLECTION must be between 0.1 and 1.0, got {angular_deflection}")
        
        return cls(
            port=int(os.getenv("PORT", "5000")),
            host=os.getenv("HOST", "0.0.0.0"),
            environment=os.getenv("NODE_ENV", "development"),
            cors_origins=cors_origins,
            max_file_size_bytes=max_file_size_bytes,
            rate_limit_per_minute=int(os.getenv("RATE_LIMIT_PER_MINUTE", "10")),
            linear_deflection=linear_deflection,
            angular_deflection=angular_deflection,
            temp_dir=os.getenv("TEMP_DIR", os.getenv("TMPDIR", "/tmp/cad-files")),
            log_level=os.getenv("LOG_LEVEL", "info").upper()
        )
    
    def is_production(self) -> bool:
        """Check if running in production mode"""
        return self.environment.lower() == "production"
    
    def validate(self) -> None:
        """Validate configuration values"""
        if self.port < 1 or self.port > 65535:
            raise ValueError(f"Invalid port: {self.port}")
        
        if self.max_file_size_bytes < 1024 * 1024:  # Minimum 1MB
            raise ValueError("MAX_FILE_SIZE_MB must be at least 1")
        
        if self.rate_limit_per_minute < 1:
            raise ValueError("RATE_LIMIT_PER_MINUTE must be at least 1")
        
        if not self.cors_origins:
            raise ValueError("CORS_ORIGINS cannot be empty")
