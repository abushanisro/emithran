"""
File validation utilities

Provides security-focused file validation including magic number checking
"""

import os
from pathlib import Path
from typing import Tuple

from exceptions import FileSizeExceededError, InvalidFileTypeError


# STEP file magic numbers (file signatures)
STEP_MAGIC_NUMBERS = [
    b'ISO-10303-21;',  # Standard STEP header
    b'ISO-10303-28;',  # XML STEP
]

# Allowed file extensions
ALLOWED_EXTENSIONS = {'.step', '.stp', '.iges', '.igs', '.sldprt'}

# Extensions that bypass STEP magic number check (proprietary binary formats)
BINARY_NATIVE_EXTENSIONS = {'.sldprt'}


class FileValidator:
    """Validates uploaded files for security and compatibility"""
    
    def __init__(self, max_file_size_bytes: int):
        """
        Initialize file validator
        
        Args:
            max_file_size_bytes: Maximum allowed file size in bytes
        """
        self.max_file_size_bytes = max_file_size_bytes
    
    def validate_file_size(self, file_path: str) -> None:
        """
        Validate file size
        
        Args:
            file_path: Path to file
            
        Raises:
            FileSizeExceededError: If file exceeds size limit
        """
        file_size = os.path.getsize(file_path)
        
        if file_size > self.max_file_size_bytes:
            max_mb = self.max_file_size_bytes / (1024 * 1024)
            actual_mb = file_size / (1024 * 1024)
            raise FileSizeExceededError(
                f"File size {actual_mb:.2f}MB exceeds maximum allowed size {max_mb:.2f}MB"
            )
    
    def validate_file_extension(self, filename: str) -> str:
        """
        Validate file extension
        
        Args:
            filename: Original filename
            
        Returns:
            Lowercase file extension
            
        Raises:
            InvalidFileTypeError: If extension is not allowed
        """
        file_ext = Path(filename).suffix.lower()
        
        if file_ext not in ALLOWED_EXTENSIONS:
            raise InvalidFileTypeError(
                f"Invalid file type: {file_ext}. Supported: {', '.join(ALLOWED_EXTENSIONS)}"
            )
        
        return file_ext
    
    def validate_magic_number(self, file_path: str, file_ext: str = '') -> None:
        """
        Validate file content using magic number (file signature)

        This prevents users from uploading malicious files with renamed extensions.
        Proprietary binary formats (e.g. .sldprt) bypass the STEP header check.

        Args:
            file_path: Path to file
            file_ext: Lowercase file extension (used to skip check for native formats)

        Raises:
            InvalidFileTypeError: If file signature doesn't match STEP format
        """
        if file_ext in BINARY_NATIVE_EXTENSIONS:
            return

        try:
            # Read first 512 bytes for magic number check
            with open(file_path, 'rb') as f:
                header = f.read(512)

            # Check for STEP magic numbers
            is_valid = any(
                magic_num in header
                for magic_num in STEP_MAGIC_NUMBERS
            )

            if not is_valid:
                raise InvalidFileTypeError(
                    "File content does not match STEP format. "
                    "Please upload a valid STEP/IGES file."
                )

        except IOError as e:
            raise InvalidFileTypeError(f"Cannot read file for validation: {str(e)}")
    
    def validate_file(self, file_path: str, filename: str) -> Tuple[str, int]:
        """
        Perform complete file validation
        
        Args:
            file_path: Path to uploaded file
            filename: Original filename
            
        Returns:
            Tuple of (file_extension, file_size)
            
        Raises:
            FileValidationError: If any validation fails
        """
        # 1. Validate extension
        file_ext = self.validate_file_extension(filename)

        # 2. Validate size
        self.validate_file_size(file_path)

        # 3. Validate magic number (content); skipped for native binary formats
        self.validate_magic_number(file_path, file_ext)
        
        # Return validated info
        file_size = os.path.getsize(file_path)
        return file_ext, file_size
