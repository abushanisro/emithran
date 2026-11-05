# Running the CAD Engine

Everyday runbook, the same on Windows, macOS and Linux. For *why* it runs in a
container rather than natively, see "Local Development" in
[`README.md`](./README.md).

Every command below is plain `docker compose` run **from the `cad-engine`
directory of your checkout**. Only the place you type it differs by host:

| Host | Where to run the commands |
|------|---------------------------|
| macOS, Linux | any terminal, in `cad-engine/` (Docker Desktop, OrbStack or Docker Engine) |
| Windows | inside your WSL2 Ubuntu distro: `wsl -d Ubuntu-24.04`, then `cd /mnt/c/<path to your checkout>/cad-engine` |

Windows can run a single command without opening the distro:

```powershell
wsl -d Ubuntu-24.04 -- bash -lc "cd /mnt/c/<path to your checkout>/cad-engine && docker compose -f docker-compose.dev.yml up"
```

**Apple Silicon:** the engine's OpenCASCADE binding exists for linux/amd64 only, so
the compose file pins that platform and Docker emulates it. In Docker Desktop turn on
Settings > General > "Use Rosetta for x86_64/amd64 emulation" (OrbStack does this by
default). It runs slower than native but is the same image every other host runs.

---

## TL;DR

Leave this running in a dedicated terminal for your work session (no `-d`):

```bash
docker compose -f docker-compose.dev.yml up
```

Then open http://localhost:5055/health - it should return `"status":"healthy"`.
Ctrl+C in that terminal stops the engine.

While it runs, the source tree is bind-mounted and uvicorn runs with `--reload`,
so editing a `.py` file restarts the app by itself. No rebuild, no manual restart.

---

## Everyday commands

### Start

Foreground, for a work session (see "Keeping it running" on Windows):

```bash
docker compose -f docker-compose.dev.yml up
```

Detached (on Windows, only if you already have another WSL session open):

```bash
docker compose -f docker-compose.dev.yml up -d
```

After the first build, either takes a few seconds.

### Stop

```bash
docker compose -f docker-compose.dev.yml down
```

### Follow logs

```bash
docker compose -f docker-compose.dev.yml logs -f cad-engine
```

Ctrl+C stops following; it does not stop the container.

### Run the tests

```bash
docker compose -f docker-compose.dev.yml --profile test run --rm tests
```

Expected: `75 passed`. The test image is separate from the production image so
pytest never ships to Railway - see `Dockerfile.dev`.

### Shell inside the running container

```bash
docker compose -f docker-compose.dev.yml exec cad-engine bash
```

Inside it, activate the environment before using Python:

```bash
source /opt/conda/etc/profile.d/conda.sh && conda activate cad-env
python -c "import OCC; print(OCC.VERSION)"
```

### Rebuild the image

Only needed when `Dockerfile`, `requirements.txt` or the conda dependency list
changes - not for ordinary `.py` edits.

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

A full rebuild downloads roughly 1.5 GB of conda packages and takes 20-30
minutes (longer under Apple Silicon emulation). If the download fails, see
Troubleshooting. If you changed `requirements-dev.txt`, also rebuild the test image:

```bash
docker compose -f docker-compose.dev.yml --profile test build tests
```

---

## Checking it works

```bash
curl http://localhost:5055/health
```

Healthy output contains `"status":"healthy"` and
`"opencascade":"pythonocc-core 7.7.2"`.

The NestJS backend defaults `CAD_ENGINE_URL` to `http://localhost:5055`. The
published port is reachable on the host's `localhost` on every platform (WSL2
forwards it to Windows), so no backend configuration is needed.

---

## Keeping it running (Windows / WSL2 only)

On macOS and Linux Docker keeps running on its own and the dev service restarts
with the daemon; skip this section. On Windows, run it in the foreground, as in
the TL;DR above. This matters more than it looks.

WSL2 shuts down an idle VM when no client is attached, and **systemd and a
running container do not keep it alive**. So `docker compose up -d` starts fine
and then dies roughly a minute later, taking the engine with it. It is a clean
shutdown, not a crash - the container reports `Exited (0)` and the VM reports
`up 0 minutes`, because your next command is what booted it again.

Two ways to hold the VM open:

1. **Run compose in the foreground** (recommended). The attached terminal keeps
   the VM alive and you get live logs in the same window.
2. **Keep any WSL session open** - `wsl -d Ubuntu-24.04` in a spare terminal is
   enough. With a session attached, `up -d` behaves the way you would expect.

Use `up -d` on its own only for a quick one-off check, not for a work session.

If you would rather the container return by itself whenever the VM next boots,
add `restart: unless-stopped` to the `cad-engine` service in
`docker-compose.dev.yml`. It is deliberately not enabled by default, so nothing
starts on your machine without you asking.

---

## Troubleshooting

### `http://localhost:5055` does not respond

First check the container is up: `docker compose -f docker-compose.dev.yml ps`. If it
is not, start it (TL;DR). On **Windows**, it is almost always that the WSL VM shut itself down and took the container with it. WSL2
stops an idle VM when no client is attached - systemd and a running container do
NOT keep it alive. The container stops gracefully (exit code 0, not a crash) and
does not come back, because the dev service has no restart policy.

Confirm with:

```powershell
wsl -d Ubuntu-24.04 -- bash -lc "uptime -p; docker ps -a --format '{{.Names}} | {{.Status}}'"
```

`up 0 minutes` plus `Exited (0)` is this exact situation - the VM had just been
booted by your own command. Restart with the Start command, and see
"Keeping it running" above to avoid it recurring.

### Build fails with `PackagesNotFoundInChannelsError: pythonocc-core=7.7.2` (Apple Silicon)

The build ran for the host's own architecture, and conda-forge has no linux-aarch64
build of that version. The compose file pins `platform: linux/amd64` for this; if you
build the image some other way, pass `--platform linux/amd64` (or export
`DOCKER_DEFAULT_PLATFORM=linux/amd64`).

### `ImportError: DLL load failed while importing _GeomAbs` (Windows)

You ran `python main.py` natively on Windows. That cannot work while Smart App
Control is enforcing - it blocks pythonocc-core's unsigned `.pyd` files at load
time. Use the container. Full explanation in `README.md`.

### Build fails with `CondaHTTPError: HTTP 000 CONNECTION FAILED`

A VPN is almost certainly active (Windows/WSL2 observed). Proton VPN (`ProTUN`) takes the default route
at MTU 1420 and cannot sustain the ~1.5 GB conda download; measured throughput
was 777 KB/s through the tunnel versus 2.09 MB/s direct.

Disconnect the VPN, then restart WSL so it picks up the new MTU:

```powershell
wsl --shutdown
```

Rebuild, then reconnect the VPN. Only builds are affected - running the already
built image is fine with the VPN on.

### Commands fail from Git Bash (Windows) with a path like `C:/Program Files/Git/mnt/c/...`

Git Bash rewrites arguments that look like Unix paths. Prefix the command with
`MSYS_NO_PATHCONV=1`, or just use PowerShell.

### Windows runs out of memory during a build (WSL2)

`~/.wslconfig` caps WSL at 6 GB + 4 GB swap with `autoMemoryReclaim=gradual`.
If a build still strains the machine, close Chrome/VS Code for the duration, or
lower `memory=` in that file. Changing it requires `wsl --shutdown` to take
effect, which kills any build in progress.

### The build or the engine is very slow or runs out of memory (Apple Silicon)

Emulation is slower than native, and the OpenCASCADE build is memory hungry. Give Docker
Desktop at least 6 GB (Settings > Resources), and use Rosetta emulation rather than QEMU.

---

## One-time setup

**macOS / Linux:** install Docker and nothing else (see `README.md`).

**Windows:** only needed on a fresh machine. Requires WSL2; Docker Engine is installed
inside the distro, so Docker Desktop is not used.

```powershell
wsl --install -d Ubuntu-24.04 --no-launch
wsl -d Ubuntu-24.04 -u root bash /mnt/c/<path to your checkout>/cad-engine/scripts/provision-wsl-docker.sh
wsl --shutdown
wsl -d Ubuntu-24.04 -- docker version
```

`scripts/provision-wsl-docker.sh` is idempotent and safe to re-run.
