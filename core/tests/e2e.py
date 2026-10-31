#!/usr/bin/env python3
"""
End to end, with nothing faked except the data API and the bucket: the real `cad-runner` and the real C++ `geometry-worker` inside
the cad-core image, on a real zip of the repo's STEP fixtures, against a small stand-in for the PostgREST calls and the path-style S3
requests the runner makes.
Checks that the runner claims the upload, unzips it, runs the worker (under prlimit, empty environment), stores one STEP file per
distinct part (the customer's own bytes for a single-part file), and ends the upload `analysed` with a report that equals the tree.

  docker build --platform linux/amd64 --build-context geometry=geometry-worker --build-context fixtures=backend/test/fixtures/cad -t cad-core:dev core
  python3 core/tests/e2e.py
"""
import io
import json
import subprocess
import sys
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

FIXTURES = Path(__file__).resolve().parents[2] / "backend/test/fixtures/cad"
S3_BUCKET = "emithran"
FILES = f"/{S3_BUCKET}/bom-files/"
ROW = {"id": "up1", "organization_id": "org1", "file_name": "Pack.zip", "storage_path": "cad-uploads/org1/x", "attempts": 1}


def make_zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("Pack/top/nested-assembly.step", (FIXTURES / "nested-assembly.step").read_bytes())
        z.writestr("Pack/parts/plate.step", (FIXTURES / "plate.step").read_bytes())
        z.writestr("Pack/readme.txt", "not cad")
    return buf.getvalue()


class Fake(BaseHTTPRequestHandler):
    zip_bytes = make_zip()
    claimed = False
    uploads: dict = {}
    patches: list = []
    done = threading.Event()

    def log_message(self, *_):
        pass

    def _send(self, code, body=b"", ctype="application/json"):
        self.send_response(code)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        return self.rfile.read(int(self.headers.get("content-length", 0)))

    def do_POST(self):
        self._body()
        if self.path == "/rpc/claim_next_cad_upload" and self.headers.get("authorization", "").startswith("Bearer "):
            rows = [] if Fake.claimed else [ROW]
            Fake.claimed = True
            return self._send(200, json.dumps(rows).encode())
        self._send(404)

    def do_PUT(self):
        body = self._body()
        if self.path.startswith(FILES):
            Fake.uploads[self.path.removeprefix(FILES)] = body
            return self._send(200)
        self._send(404)

    def do_GET(self):
        if self.path == FILES + ROW["storage_path"]:
            return self._send(200, Fake.zip_bytes, "application/zip")
        self._send(404)

    def do_PATCH(self):
        if not self.path.startswith("/cad_uploads?"):
            return self._send(404)
        Fake.patches.append(json.loads(self._body()))
        Fake.done.set()
        self._send(200, b"[]")

    def do_DELETE(self):
        self._body()
        self._send(204)


def main() -> int:
    server = ThreadingHTTPServer(("0.0.0.0", 0), Fake)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    container = subprocess.run(
        ["docker", "run", "-d", "--rm", "--platform", "linux/amd64", "--add-host", "host.docker.internal:host-gateway",
         "-e", f"POSTGREST_URL=http://host.docker.internal:{port}", "-e", "DB_JWT_SECRET=" + "s" * 40,
         "-e", f"S3_ENDPOINT=http://host.docker.internal:{port}", "-e", f"S3_BUCKET={S3_BUCKET}", "-e", "S3_REGION=us-east-1",
         "-e", "S3_FORCE_PATH_STYLE=true", "-e", "S3_ACCESS_KEY_ID=test", "-e", "S3_SECRET_ACCESS_KEY=test", "-e", "POLL_SECONDS=1",
         "cad-core:dev"], check=True, capture_output=True, text=True).stdout.strip()
    try:
        finished = Fake.done.wait(timeout=120)
        time.sleep(0.5)
        healthy = subprocess.run(["docker", "exec", container, "cad-runner", "health"], capture_output=True).returncode == 0
        logs = subprocess.run(["docker", "logs", container], capture_output=True, text=True)
        log = logs.stdout + logs.stderr
    finally:
        subprocess.run(["docker", "stop", "-t", "2", container], capture_output=True)
        server.shutdown()

    problems = []
    if not healthy:
        problems.append("`cad-runner health` (the container healthcheck) failed while the runner was running")
    if not finished or not Fake.patches:
        problems.append("the runner never reported a result")
        print(log)
    else:
        patch = Fake.patches[-1]
        if patch.get("status") != "analysed":
            problems.append(f"expected status analysed, got {patch}")
        else:
            report = patch["result"]["report"]
            names = sorted(p["name"] for p in report["parts"])
            if names != ["Box", "Cyl", "Plate"]:
                problems.append(f"parts are {names}")
            totals = {p["name"]: p["quantity_total"] for p in report["parts"]}
            if totals != {"Box": 4, "Cyl": 3, "Plate": 1}:
                problems.append(f"quantities are {totals}")
            files = {p["name"]: p["file"] for p in report["parts"]}
            if files["Plate"] != "Pack/parts/plate.step" or files["Box"] != "Pack/top/nested-assembly.step":
                problems.append(f"file names were not mapped back to the zip's paths: {files}")
            if patch["result"]["skipped"] != [{"path": "Pack/readme.txt", "reason": "not a STEP file"}]:
                problems.append(f"skipped is {patch['result']['skipped']}")
        stored = sorted(p.rsplit("/", 1)[1] for p in Fake.uploads)
        if len(stored) != 3:
            problems.append(f"expected 3 stored part files, got {stored}")
        if (FIXTURES / "plate.step").read_bytes() not in Fake.uploads.values():
            problems.append("the single-part file was not stored with the customer's own bytes")
        if any(not b.startswith(b"ISO-10303-21") for b in Fake.uploads.values()):
            problems.append("a stored part is not a STEP file")
    print("ok   runner + real worker, end to end" if not problems else "FAIL runner + real worker, end to end")
    for p in problems:
        print("     ", p)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
