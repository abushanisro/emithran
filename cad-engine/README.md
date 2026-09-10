# mithran CAD Engine

Professional STEP to STL conversion service using OpenCascade Technology (OCCT).

## Technology Stack

- **OpenCascade Technology (OCCT)** - Industry-standard CAD kernel
  - Same technology as: FreeCAD, Salome, CAD Exchanger, CATIA
  - ISO 10303 (STEP) standard compliance
  - Professional B-Rep to mesh conversion

- **FastAPI** - Modern Python web framework
- **pythonocc-core** - Python bindings for OpenCascade

## Features

- ✅ STEP/STP file parsing
- ✅ IGES/IGS file support
- ✅ High-quality mesh generation
- ✅ Binary STL export (optimized file size)
- ✅ Base64 encoding option
- ✅ Parallel mesh processing
- ✅ Comprehensive logging
- ✅ Automatic temp file cleanup
- ✅ Manufacturing feature extraction (Sheet Metal, Injection Molding, CNC/Machining) —
  see [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the domain-folder layout
  (`sheet_metal/`, `injection_molding/`, `machining/`, `shared/`) and the
  verified cross-domain dependency graph
- ✅ 2D drawing/PDF title-block analysis (`drawing_analyzer.py`)
- ✅ Real-polygon 2D nesting for the Nest View feature (`sheet_metal/nesting.py`)

## API Endpoints

### `GET /`
Health check and service info

**Response:**
```json
{
  "service": "mithran CAD Engine",
  "status": "running",
  "version": "1.0.0",
  "engine": "OpenCascade Technology (OCCT)"
}
```

### `GET /health`
Detailed health check

**Response:**
```json
{
  "status": "healthy",
  "opencascade": "pythonocc-core 7.7.2",
  "capabilities": ["STEP", "IGES", "STL"]
}
```

### `POST /convert/step-to-stl`
Convert STEP file to STL (binary format)

**Request:**
- Content-Type: `multipart/form-data`
- File field: `file`
- Supported extensions: `.step`, `.stp`, `.iges`, `.igs`

**Response:**
- Content-Type: `application/octet-stream`
- Binary STL file
- Headers:
  - `X-Original-Filename`: Original file name
  - `X-Conversion-Engine`: "OpenCascade"

### `POST /convert/step-to-stl-base64`
Convert STEP file to STL and return as base64

**Request:**
- Content-Type: `multipart/form-data`
- File field: `file`

**Response:**
```json
{
  "success": true,
  "original_filename": "part.step",
  "stl_filename": "part.stl",
  "stl_size": 12345,
  "stl_base64": "..."
}
```

## Local Development

The engine runs in a Linux container, not natively on the host.
For day-to-day start/stop/test commands see [`RUNNING.md`](./RUNNING.md);
this section covers why, and first-time setup.

### Why not `python main.py` on Windows

pythonocc-core ships unsigned `.pyd` binaries. With Windows 11 Smart App Control
enforcing, Code Integrity refuses to map them into `python.exe`:

```
ImportError: DLL load failed while importing _GeomAbs:
An Application Control policy has blocked this file.
```

That is an operating-system policy block (CodeIntegrity event 3077, SAC policy
`{0283AC0F-FFF1-49AE-ADA1-8A933130CAD6}`), not a broken install. Smart App
Control exposes no allowlist or exclusion mechanism, and locally trusted or
self-signed certificates do not satisfy it, so reinstalling the conda package or
re-signing the binaries cannot fix it. The container is the supported path, and
it also makes local runs match the image Railway deploys.

### One-time host setup (Windows)

Requires WSL2. Docker Engine runs inside the distro, so Docker Desktop is not
needed and no Windows administrator rights are required beyond WSL itself.

```powershell
wsl --install -d Ubuntu-24.04 --no-launch
wsl -d Ubuntu-24.04 -u root bash /mnt/c/Users/<you>/.../cad-engine/scripts/provision-wsl-docker.sh
wsl --shutdown
wsl -d Ubuntu-24.04 -- docker version
```

`scripts/provision-wsl-docker.sh` is idempotent: it enables systemd and drvfs
`metadata` in `/etc/wsl.conf`, creates a non-root user, and installs Docker
Engine plus the Compose plugin from Docker's official apt repository.

### Run

```bash
# inside the distro, from the cad-engine directory
docker compose -f docker-compose.dev.yml up --build
# http://localhost:5000/health - also reachable from Windows
```

The source tree is bind-mounted and uvicorn runs with `--reload`, so edits made
on the Windows side take effect without a rebuild.

### Tests

`pytest` is intentionally absent from the production image. `Dockerfile.dev`
layers it (and `requirements-dev.txt`) on top of that image, so tests run
against the exact production runtime without shipping test tooling to Railway.
Build the base first, since the test image is `FROM mithran-cad-engine:dev`:

```bash
docker compose -f docker-compose.dev.yml build cad-engine
docker compose -f docker-compose.dev.yml build tests
docker compose -f docker-compose.dev.yml run --rm tests
```

### macOS and Linux hosts

Smart App Control is Windows-only. There, `pip install -r requirements.txt` plus
`python main.py` works natively, and the compose file above works unchanged.

## Docker Deployment

Production images are built from `Dockerfile` (miniconda3 + pythonocc-core
7.7.2). Railway builds it directly via `railway.json`; the root
`../docker-compose.yml` wires the same image into the full platform stack
alongside postgres, redis, rabbitmq, minio, backend and frontend.

### Build

```bash
docker build -t mithran-cad-engine .
```

### Run

```bash
docker run -p 5000:5000 mithran-cad-engine
```

### Full platform stack

```bash
# from the repository root, with the root .env populated
docker compose up cad-engine
```

## Conversion Pipeline

1. **STEP Parsing** - Read STEP file using `STEPControl_Reader`
2. **Shape Extraction** - Extract B-Rep geometry (`TopoDS_Shape`)
3. **Mesh Generation** - Convert to triangular mesh using `BRepMesh_IncrementalMesh`
4. **STL Export** - Write binary STL using `StlAPI_Writer`

## Performance

- Parallel mesh generation enabled
- Binary STL format (smaller than ASCII)
- Automatic temp file cleanup
- Streaming file responses

## Industry Standards

Follows CAD industry best practices:
- ISO 10303 (STEP) compliance
- STL binary format specification
- Professional mesh quality settings
- Same algorithms as commercial CAD software

## License

Professional implementation for mithran Platform.
