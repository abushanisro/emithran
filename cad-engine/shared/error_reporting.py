"""Failures reported to the caller without the exception text.

Exception text can carry file paths, library internals or the customer's own content, so it never goes into anything an API returns: not an HTTP
detail, not a warning, not an "error" or "unresolved" field. The full traceback goes to the log under a fresh error id; the caller gets what failed
and the id, which is enough to find the traceback.
"""
import logging
import uuid


def report_failure(operation: str, logger: logging.Logger) -> str:
    """Log the exception being handled (with its traceback) under a fresh id and return the text that is safe to put in a response.

    Call it inside an ``except`` block. The result reads "<operation> failed (error <id>)."
    """
    error_id = uuid.uuid4().hex
    logger.error("%s failed (error %s)", operation, error_id, exc_info=True)
    return f"{operation} failed (error {error_id})."
