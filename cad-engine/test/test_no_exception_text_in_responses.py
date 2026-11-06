"""Exception text never goes into data the engine returns.

A handler that catches an exception and puts its text (str(e), repr(e), an f-string with e) into a list, a dict, a returned value or an attribute hands
that text to the API caller: file paths, library internals, the customer's own content (CodeQL py/stack-trace-exposure). The way to report a failure is
shared.error_reporting.report_failure (an id in the response, the traceback in the log). Raising (the engine's own validation messages) and logging
are not responses and are not checked here.

This reads every engine source file, so it needs no CAD kernel.
"""
import ast
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SKIP_DIRS = {"test", "tests", "scripts", ".venv", "venv", "node_modules", "__pycache__"}
LOG_METHODS = {"debug", "info", "warning", "warn", "error", "exception", "critical", "log"}


def _sources():
    for path in sorted(ROOT.rglob("*.py")):
        if not (set(path.relative_to(ROOT).parts) & SKIP_DIRS):
            yield path


def _parents(tree: ast.AST) -> dict:
    parents = {}
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            parents[child] = node
    return parents


def _is_log_call(node: ast.AST) -> bool:
    return isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in LOG_METHODS


def _reaches_response_data(use: ast.Name, handler: ast.ExceptHandler, parents: dict) -> bool:
    """Whether this use of the exception ends up in a returned value, a container or an attribute, rather than a log line, a raise or a type check."""
    node: ast.AST = use
    while node is not handler:
        parent = parents[node]
        if isinstance(parent, (ast.Raise, ast.Delete)) or _is_log_call(parent):
            return False
        if isinstance(parent, ast.Call) and isinstance(parent.func, ast.Name) and parent.func.id in {"type", "isinstance"}:
            return False  # the class, not the message
        if isinstance(parent, ast.Attribute) and parent.attr in {"__name__", "__class__"}:
            return False
        if isinstance(parent, ast.Call) and isinstance(parent.func, ast.Attribute) and parent.func.attr in {"append", "extend", "add", "insert", "update"}:
            return True
        if isinstance(parent, (ast.Dict, ast.List, ast.Tuple, ast.Set, ast.Return, ast.Yield)):
            return True
        if isinstance(parent, (ast.Assign, ast.AugAssign, ast.AnnAssign)):
            return True
        node = parent
    return False


def exception_text_in_responses(source: str) -> list:
    tree = ast.parse(source)
    parents = _parents(tree)
    found = []
    for handler in (n for n in ast.walk(tree) if isinstance(n, ast.ExceptHandler) and n.name):
        for use in (n for n in ast.walk(handler) if isinstance(n, ast.Name) and n.id == handler.name and isinstance(n.ctx, ast.Load)):
            if _reaches_response_data(use, handler, parents):
                found.append(use.lineno)
    return sorted(set(found))


def test_no_engine_module_puts_exception_text_into_data_it_returns():
    offenders = {}
    for path in _sources():
        lines = exception_text_in_responses(path.read_text(encoding="utf-8"))
        if lines:
            offenders[str(path.relative_to(ROOT))] = lines
    assert offenders == {}, (
        "exception text reaches response data (use shared.error_reporting.report_failure: an error id in the response, the traceback in the log): "
        f"{offenders}"
    )


def test_the_guard_catches_what_it_is_for():
    leaking = (
        "def f(warnings):\n    try:\n        g()\n    except Exception as exc:\n        warnings.append(f'failed: {exc}')\n"
        "def h():\n    try:\n        g()\n    except Exception as e:\n        return {'error': str(e)}\n"
        "def k(result):\n    try:\n        g()\n    except Exception as e:\n        result['unresolved'] = [str(e)]\n"
    )
    assert exception_text_in_responses(leaking) == [5, 10, 15]


def test_the_guard_allows_logging_raising_and_type_names():
    fine = (
        "def f(log):\n    try:\n        g()\n    except Exception as exc:\n        log.warning(f'x {exc}')\n        raise RuntimeError(str(exc)) from exc\n"
        "def h():\n    try:\n        g()\n    except Exception as e:\n        return {'kind': type(e).__name__}\n"
        "def k(warnings, logger):\n    try:\n        g()\n    except Exception:\n        warnings.append(report_failure('X', logger))\n"
    )
    assert exception_text_in_responses(fine) == []
