"""
Admission and watchdog for heavy OpenCascade requests.

The heavy handlers are plain `def`, so they run in the threadpool and never block the event loop. This gate bounds how
many run at once; a request that cannot get a slot in time gets a retryable 429 (backpressure, not an outage, so a
caller's circuit breaker stays closed).

A thread stuck inside OpenCascade cannot be cancelled, and would hold its slot until the process dies. The watchdog
turns that into a restart: when any request has run longer than the hard limit it ends the process, and the
container's restart policy brings it back. Callers see a connection error and retry, which is what they already do.
"""
from __future__ import annotations

import itertools
import logging
import os
import threading
import time
from typing import Callable, Dict, Iterator, Optional

from fastapi import HTTPException

logger = logging.getLogger(__name__)

EXIT_CODE_OVERDUE = 70


def _end_process() -> None:
    os._exit(EXIT_CODE_OVERDUE)


class AnalysisGate:
    def __init__(self, max_concurrent: int, wait_seconds: float, hard_limit_seconds: float,
                 on_overdue: Callable[[], None] = _end_process, clock: Callable[[], float] = time.monotonic):
        self._slots = threading.BoundedSemaphore(max_concurrent)
        self._wait = wait_seconds
        self._limit = hard_limit_seconds
        self._on_overdue = on_overdue
        self._clock = clock
        self._ids = itertools.count()
        self._started: Dict[int, float] = {}
        self._lock = threading.Lock()
        self.max_concurrent = max_concurrent

    def slot(self) -> Iterator[None]:
        """FastAPI dependency: holds a slot for the whole request."""
        if not self._slots.acquire(timeout=self._wait):
            raise HTTPException(status_code=429, detail="CAD engine busy, retry shortly", headers={"Retry-After": "15"})
        key = next(self._ids)
        with self._lock:
            self._started[key] = self._clock()
        try:
            yield
        finally:
            with self._lock:
                del self._started[key]
            self._slots.release()

    def running(self) -> int:
        with self._lock:
            return len(self._started)

    def oldest_seconds(self) -> float:
        with self._lock:
            return max((self._clock() - t for t in self._started.values()), default=0.0)

    def check(self) -> bool:
        """True (and the overdue action taken) when a request has run past the hard limit. A limit of 0 disables it."""
        if self._limit > 0 and self.oldest_seconds() > self._limit:
            logger.critical(f"[watchdog] an analysis has run for over {self._limit:.0f}s; ending the process so it restarts")
            self._on_overdue()
            return True
        return False

    def start_watchdog(self, interval_seconds: float = 30.0) -> Optional[threading.Thread]:
        if self._limit <= 0:
            return None

        def loop() -> None:
            while True:
                time.sleep(interval_seconds)
                self.check()

        thread = threading.Thread(target=loop, name="analysis-watchdog", daemon=True)
        thread.start()
        return thread
