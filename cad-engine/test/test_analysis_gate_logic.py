"""AnalysisGate: bounded slots, honest load numbers, and a watchdog that ends a hung process (never in the test)."""
import pytest
from fastapi import HTTPException

from shared.analysis_gate import AnalysisGate


class Clock:
    now = 100.0

    def __call__(self) -> float:
        return self.now


def gate(max_concurrent=2, wait=0.05, limit=900, clock=None, calls=None):
    return AnalysisGate(max_concurrent, wait, limit, on_overdue=(lambda: calls.append("exit")) if calls is not None else (lambda: None), clock=clock or Clock())


def test_load_numbers_follow_the_requests_that_hold_a_slot():
    clock = Clock()
    g = gate(clock=clock)
    first, second = g.slot(), g.slot()
    next(first)
    clock.now += 40
    next(second)
    clock.now += 5
    assert g.running() == 2 and g.oldest_seconds() == 45
    first.close()
    assert g.running() == 1 and g.oldest_seconds() == 5
    second.close()
    assert g.running() == 0 and g.oldest_seconds() == 0


def test_a_full_gate_answers_429_with_retry_after_and_frees_up_again():
    g = gate(max_concurrent=1)
    held = g.slot()
    next(held)
    with pytest.raises(HTTPException) as busy:
        next(g.slot())
    assert busy.value.status_code == 429 and busy.value.headers == {"Retry-After": "15"}
    held.close()
    again = g.slot()
    next(again)  # a slot is free again
    assert g.running() == 1


def test_a_slot_is_released_when_the_request_fails():
    g = gate(max_concurrent=1)
    request = g.slot()
    next(request)
    with pytest.raises(RuntimeError):
        request.throw(RuntimeError("analysis blew up"))
    assert g.running() == 0
    again = g.slot()
    next(again)


def test_the_watchdog_acts_only_when_a_request_runs_past_the_limit():
    clock, calls = Clock(), []
    g = gate(limit=900, clock=clock, calls=calls)
    request = g.slot()
    next(request)
    clock.now += 900
    assert g.check() is False and calls == []
    clock.now += 1
    assert g.check() is True and calls == ["exit"]


def test_a_limit_of_zero_turns_the_watchdog_off():
    clock, calls = Clock(), []
    g = gate(limit=0, clock=clock, calls=calls)
    request = g.slot()
    next(request)
    clock.now += 10_000
    assert g.check() is False and calls == []
    assert g.start_watchdog() is None


def test_a_hung_request_really_ends_the_process_with_the_restart_exit_code():
    """The one thing the injected clock cannot show: the default action ends a real process whose main thread is stuck."""
    import subprocess
    import sys
    from pathlib import Path

    code = (
        "import time\n"
        "from shared.analysis_gate import AnalysisGate\n"
        "g = AnalysisGate(1, 1, 0.3)\n"
        "request = g.slot(); next(request)\n"      # a request that never finishes
        "g.start_watchdog(interval_seconds=0.1)\n"
        "time.sleep(30)\n"
    )
    done = subprocess.run([sys.executable, "-c", code], cwd=Path(__file__).resolve().parent.parent, capture_output=True, timeout=20)
    assert done.returncode == 70
