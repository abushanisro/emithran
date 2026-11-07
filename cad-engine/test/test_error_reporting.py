"""report_failure: the caller gets what failed and an id; the traceback goes to the log under the same id; the exception text goes nowhere else."""
import logging
import re

from shared.error_reporting import report_failure

SECRET = "/srv/customer-data/part-4711.step: invalid entity #88"


def _fail_and_report(operation: str, logger: logging.Logger) -> str:
    try:
        raise ValueError(SECRET)
    except Exception:
        return report_failure(operation, logger)


def test_the_result_names_the_operation_and_an_id_and_never_the_exception_text(caplog):
    message = _fail_and_report("Reading the dimensions", logging.getLogger("t"))
    assert re.fullmatch(r"Reading the dimensions failed \(error [0-9a-f]{32}\)\.", message)
    assert SECRET not in message and "ValueError" not in message


def test_the_traceback_is_logged_under_the_same_id(caplog):
    with caplog.at_level(logging.ERROR, logger="t"):
        message = _fail_and_report("Face classification", logging.getLogger("t"))
    error_id = re.search(r"error ([0-9a-f]{32})", message).group(1)
    [record] = caplog.records
    assert error_id in record.getMessage()
    assert record.exc_info and record.exc_info[0] is ValueError and SECRET in str(record.exc_info[1])


def test_every_failure_gets_its_own_id():
    ids = {re.search(r"error ([0-9a-f]{32})", _fail_and_report("X", logging.getLogger("t"))).group(1) for _ in range(20)}
    assert len(ids) == 20
