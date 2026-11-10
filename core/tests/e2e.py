#!/usr/bin/env python3
"""
End to end, with nothing faked except the data API and the bucket: the real `cad-runner` (cad-core image) and the real C++
`geometry-worker` under the real `cad-worker-host` (cad-worker image), each in its own container started with the same isolation
as docker-compose.prod.yml, on a real zip of the repo's STEP fixtures, against a small stand-in for the PostgREST calls and the
path-style S3 requests the runner makes.

Checks that the runner claims the upload as the cad_runner role, hands the files to the worker over the shared socket, stores one
STEP file per distinct part (the customer's own bytes for a single-part file), and ends the upload `analysed` with a report that
equals the tree. Then checks the isolation itself: the worker container has no credential in its environment and no network
interface but loopback, the runner's own process environment no longer holds its credentials, and a process a worker leaves
behind does not survive its job.

  docker build --build-context geometry=geometry-worker --build-context fixtures=backend/test/fixtures/cad --target worker -t cad-worker:dev core
  docker build -t cad-core:dev core
  python3 core/tests/e2e.py
"""
import base64
import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

FIXTURES = Path(__file__).resolve().parents[2] / "backend/test/fixtures/cad"
S3_BUCKET = "emithran"
FILES = f"/{S3_BUCKET}/bom-files/"
ROW = {"id": "up1", "organization_id": "org1", "file_name": "Pack.zip", "storage_path": "cad-uploads/org1/x", "attempts": 1}
SECRET_NAMES = ["DB_JWT_SECRET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]
DB_JWT_SECRET = "s" * 40
S3_SECRET = "e2e-bucket-secret-value"


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
    finished: list = []
    roles: set = set()
    done = threading.Event()

    @classmethod
    def reset(cls):
        cls.claimed, cls.uploads, cls.finished, cls.roles = False, {}, [], set()
        cls.done = threading.Event()

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

    def _role(self):
        auth = self.headers.get("authorization", "")
        if not auth.startswith("Bearer "):
            return None
        body = auth.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))).get("role")

    def do_POST(self):
        body = self._body()
        role = self._role()
        if role is None:
            return self._send(401)
        Fake.roles.add(role)
        if self.path == "/rpc/claim_next_cad_upload":
            rows = [] if Fake.claimed else [ROW]
            Fake.claimed = True
            return self._send(200, json.dumps(rows).encode())
        if self.path in ("/rpc/cad_runner_mark_analysed", "/rpc/cad_runner_mark_failed"):
            Fake.finished.append((self.path.rsplit("/", 1)[1], json.loads(body)))
            Fake.done.set()
            return self._send(200, b"true")
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

    def do_DELETE(self):
        self._body()
        self._send(204)


def docker(*args, check=True):
    return subprocess.run(["docker", *args], check=check, capture_output=True, text=True)


def start_pair(port, volume, extra_worker_args=()):
    """The worker and the runner, isolated as in docker-compose.prod.yml (cad-worker, cad-core)."""
    hardened = ["--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true"]
    worker = docker(
        "run", "-d", "--rm", *hardened, "--network", "none", "--user", "10005:10005",
        "--tmpfs", "/tmp:size=1g,uid=10005,gid=10005,mode=0700", "-v", f"{volume}:/run/cad-worker",
        "-e", "MAX_UPLOAD_MB=50", "-e", "WORKER_MEMORY_MB=1536", *extra_worker_args, "cad-worker:dev").stdout.strip()
    for _ in range(60):
        if docker("exec", worker, "cad-worker-host", "health", check=False).returncode == 0:
            break
        time.sleep(0.5)
    runner = docker(
        "run", "-d", "--rm", *hardened, "--user", "10003:10003", "--group-add", "10005", "--tmpfs", "/tmp:size=16m",
        "-v", f"{volume}:/run/cad-worker", "--add-host", "host.docker.internal:host-gateway",
        "-e", f"POSTGREST_URL=http://host.docker.internal:{port}", "-e", f"DB_JWT_SECRET={DB_JWT_SECRET}",
        "-e", f"S3_ENDPOINT=http://host.docker.internal:{port}", "-e", f"S3_BUCKET={S3_BUCKET}", "-e", "S3_REGION=us-east-1",
        "-e", "S3_FORCE_PATH_STYLE=true", "-e", "S3_ACCESS_KEY_ID=test", "-e", f"S3_SECRET_ACCESS_KEY={S3_SECRET}",
        "-e", "POLL_SECONDS=1", "cad-core:dev").stdout.strip()
    return worker, runner


def logs(container):
    out = docker("logs", container, check=False)
    return out.stdout + out.stderr


def check_analysis(problems):
    if not Fake.finished:
        problems.append("the runner never reported a result")
        return
    name, call = Fake.finished[-1]
    if name != "cad_runner_mark_analysed":
        problems.append(f"expected the upload analysed, got {name} {call}")
        return
    report = call["p_result"]["report"]
    names = sorted(p["name"] for p in report["parts"])
    if names != ["Box", "Cyl", "Plate"]:
        problems.append(f"parts are {names}")
    totals = {p["name"]: p["quantity_total"] for p in report["parts"]}
    if totals != {"Box": 4, "Cyl": 3, "Plate": 1}:
        problems.append(f"quantities are {totals}")
    files = {p["name"]: p["file"] for p in report["parts"]}
    if files["Plate"] != "Pack/parts/plate.step" or files["Box"] != "Pack/top/nested-assembly.step":
        problems.append(f"file names were not mapped back to the zip's paths: {files}")
    if call["p_result"]["skipped"] != [{"path": "Pack/readme.txt", "reason": "not a STEP file"}]:
        problems.append(f"skipped is {call['p_result']['skipped']}")
    stored = sorted(p.rsplit("/", 1)[1] for p in Fake.uploads)
    if len(stored) != 3:
        problems.append(f"expected 3 stored part files, got {stored}")
    if (FIXTURES / "plate.step").read_bytes() not in Fake.uploads.values():
        problems.append("the single-part file was not stored with the customer's own bytes")
    if any(not b.startswith(b"ISO-10303-21") for b in Fake.uploads.values()):
        problems.append("a stored part is not a STEP file")


def check_isolation(worker, runner, problems):
    info = json.loads(docker("inspect", worker).stdout)[0]
    env = info["Config"]["Env"]
    leaked = [e.split("=", 1)[0] for e in env if any(s in e for s in ("SECRET", "KEY", "TOKEN", "PASSWORD", "POSTGREST", "S3_"))]
    if leaked:
        problems.append(f"the worker container's environment holds {leaked}")
    if info["HostConfig"]["NetworkMode"] != "none":
        problems.append(f"the worker container's network mode is {info['HostConfig']['NetworkMode']}")
    if not info["HostConfig"]["ReadonlyRootfs"]:
        problems.append("the worker container's root is writable")
    # Some kernels create tunnel devices (tunl0, sit0...) in every network namespace; they are down and unconfigured. What
    # matters: no interface but loopback is up, and there is no route anywhere.
    up = docker("exec", worker, "sh", "-c",
                'for i in /sys/class/net/*; do [ -f "$i/flags" ] || continue; [ $(( $(cat "$i/flags") & 1 )) -eq 1 ] && echo "${i##*/}"; done; true').stdout.split()
    if up != ["lo"]:
        problems.append(f"the worker container has network interfaces up: {up}")
    routes = docker("exec", worker, "cat", "/proc/net/route").stdout.splitlines()[1:]
    if routes:
        problems.append(f"the worker container has IPv4 routes: {routes}")
    host_env = docker("exec", worker, "cat", "/proc/1/environ").stdout
    if any(n in host_env for n in SECRET_NAMES):
        problems.append("cad-worker-host's environment holds a credential")
    # The runner restarted itself without its credentials in the environment. Reading another process's environ needs
    # CAP_SYS_PTRACE (the runner is non-dumpable), hence the privileged exec.
    runner_env = docker("exec", "--privileged", "-u", "0", runner, "cat", "/proc/1/environ").stdout
    if not runner_env:
        problems.append("could not read the runner's process environment")
    for value in (DB_JWT_SECRET, S3_SECRET, *SECRET_NAMES):
        if value in runner_env:
            problems.append("the runner's process environment still holds a credential")
            break
    if Fake.roles != {"cad_runner"}:
        problems.append(f"the runner used database roles {sorted(Fake.roles)}, expected only cad_runner")


def check_leftovers_are_killed(worker, problems):
    listing = docker("exec", worker, "sh", "-c",
                     'for p in /proc/[0-9]*; do tr "\\0" " " < "$p/cmdline" 2>/dev/null; echo; done').stdout
    if "sleep" in listing:
        problems.append(f"a process the worker started survived its job:\n{listing}")
    scratch = docker("exec", worker, "ls", "-A", "/tmp").stdout.split()
    if scratch:
        problems.append(f"the scratch folder was not emptied after the job: {scratch}")


def scenario(port, title, check, extra_worker_args=()):
    Fake.reset()
    volume = docker("volume", "create").stdout.strip()
    worker = runner = None
    problems = []
    try:
        worker, runner = start_pair(port, volume, extra_worker_args)
        finished = Fake.done.wait(timeout=180)
        time.sleep(1)
        if not finished:
            problems.append("the runner never reported a result")
        healthy = docker("exec", runner, "cad-runner", "health", check=False).returncode == 0
        if not healthy:
            problems.append("`cad-runner health` (the container healthcheck) failed while the runner was running")
        check(worker, runner, problems)
        if problems:
            print(f"--- runner log\n{logs(runner)}\n--- worker log\n{logs(worker)}")
    finally:
        for c in (runner, worker):
            if c:
                docker("stop", "-t", "2", c, check=False)
        docker("volume", "rm", "-f", volume, check=False)
    print(f"ok   {title}" if not problems else f"FAIL {title}")
    for p in problems:
        print("     ", p)
    return problems


def main() -> int:
    server = ThreadingHTTPServer(("0.0.0.0", 0), Fake)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    problems = []
    try:
        problems += scenario(port, "runner + real worker in separate containers, end to end",
                             lambda w, r, p: (check_analysis(p), check_isolation(w, r, p)))
        with tempfile.TemporaryDirectory() as tmp:
            script = Path(tmp) / "leaves-a-process.sh"
            script.write_text("#!/bin/sh\n/bin/sleep 300 &\necho stash > /tmp/stash\nexit 6\n")
            os.chmod(tmp, 0o755)
            os.chmod(script, 0o755)
            problems += scenario(port, "a process a worker leaves behind is killed and the scratch emptied",
                                 lambda w, r, p: check_leftovers_are_killed(w, p),
                                 ("-v", f"{script}:/e2e/leaves-a-process.sh:ro", "-e", "WORKER_BIN=/e2e/leaves-a-process.sh"))
    finally:
        server.shutdown()
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
