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

### Prerequisites
```bash
python 3.11+
pip
```

### Installation
```bash
cd cad-engine
pip install -r requirements.txt
```

### Run
```bash
python main.py
# Server runs on http://localhost:5000
```

## Docker Deployment

### Build
```bash
docker build -t mithran-cad-engine .
```

### Run
```bash
docker run -p 5000:5000 mithran-cad-engine
```

### Using docker-compose
```bash
# From project root
docker-compose up cad-engine
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
