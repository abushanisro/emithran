"""
Custom exceptions for CAD Engine

Provides specific error types for better error handling
"""


class CADEngineException(Exception):
    """Base exception for CAD engine errors"""
    pass


class FileValidationError(CADEngineException):
    """Raised when file validation fails"""
    pass


class FileSizeExceededError(FileValidationError):
    """Raised when uploaded file exceeds size limit"""
    pass


class InvalidFileTypeError(FileValidationError):
    """Raised when file type is not supported"""
    pass


class StepReadError(CADEngineException):
    """Raised when STEP file cannot be read"""
    pass


class MeshingError(CADEngineException):
    """Raised when meshing operation fails"""
    pass


class StlWriteError(CADEngineException):
    """Raised when STL file cannot be written"""
    pass


class ConversionError(CADEngineException):
    """Raised when conversion pipeline fails"""
    pass
