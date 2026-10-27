"""GET /ready: readiness with reason codes only (the route is unauthenticated, so it never reveals paths or messages)."""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

CWD = Path(__file__).resolve().parent.parent


def _ready(temp_dir: str) -> tuple[int, dict]:
    code = (
        "import json\n"
        "import main\n"
        "from fastapi.testclient import TestClient\n"
        "r = TestClient(main.app).get('/ready')\n"
        "print(json.dumps([r.status_code, r.json()]))\n"
    )
    env = {**os.environ, "NODE_ENV": "development", "TEMP_DIR": temp_dir, "LOG_LEVEL": "WARNING"}
    env.pop("OTEL_EXPORTER_OTLP_ENDPOINT", None)
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, cwd=CWD, env=env, timeout=120)
    assert out.returncode == 0, out.stderr[-2000:]
    status, body = json.loads(out.stdout.strip().splitlines()[-1])
    return status, body


def test_ready_when_the_temp_directory_is_writable():
    assert _ready(tempfile.mkdtemp()) == (200, {"ready": True, "problems": []})


def test_not_ready_with_a_reason_code_when_the_temp_directory_is_missing():
    missing = os.path.join(tempfile.mkdtemp(), "does-not-exist")
    status, body = _ready(missing)
    assert status == 503
    assert body == {"ready": False, "problems": ["temp_dir_not_writable"]}
    assert missing not in json.dumps(body)  # a code, never the path
