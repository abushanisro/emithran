"""
SolidWorks SLDPRT → STEP converter.

Conversion is attempted in priority order:

  1. SolidWorks COM automation (Windows + SolidWorks installed)
     — uses the running SolidWorks instance or starts one silently.
     — Requires `pywin32` (auto-installed on Windows via requirements.txt).

  2. FreeCAD headless (any OS if FreeCAD is on PATH)
     — Install from https://www.freecad.org/

  3. RuntimeError with user-friendly instructions.

Only the first successful method is used; failures in earlier methods
fall through silently so the chain always reaches the clearest error.
"""

import os
import subprocess
import sys
import tempfile
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Method 1 — SolidWorks COM automation (Windows only)
# ---------------------------------------------------------------------------

def _convert_via_solidworks(sldprt_path: str, step_path: str) -> bool:
    """
    Convert using SolidWorks COM automation.
    Returns True on success, False if SolidWorks / pywin32 is unavailable.
    Exceptions from the COM layer are caught and logged, not re-raised.
    """
    if sys.platform != "win32":
        return False

    try:
        import win32com.client    # noqa: PLC0415
        import pythoncom          # noqa: PLC0415
    except ImportError:
        logger.debug("pywin32 not installed — skipping SolidWorks COM path")
        return False

    try:
        pythoncom.CoInitialize()
        try:
            sw = win32com.client.Dispatch("SldWorks.Application")
            sw.Visible = False

            # OpenDoc6: (filename, docType=swDocPART=1, options=swOpenDocOptions_Silent=1,
            #             configuration="", errors, warnings)
            # Pass 0 for errors/warnings — Python win32com handles out-params transparently
            doc = sw.OpenDoc6(sldprt_path, 1, 1, "", 0, 0)
            if doc is None:
                logger.warning("SolidWorks COM: OpenDoc6 returned None — file may be corrupt or locked")
                return False

            # SaveAs3: (filename, version=0 → auto-detect by extension, options=0)
            # SolidWorks maps .step → STEP AP214 automatically
            doc.SaveAs3(step_path, 0, 0)
            sw.CloseDoc(sldprt_path)

            if os.path.exists(step_path) and os.path.getsize(step_path) > 0:
                logger.info(f"SLDPRT → STEP via SolidWorks COM: {step_path}")
                return True

            logger.warning("SolidWorks COM: SaveAs3 produced no output file")
            return False

        finally:
            pythoncom.CoUninitialize()

    except Exception as exc:
        logger.warning(f"SolidWorks COM conversion failed: {exc}")
        return False


# ---------------------------------------------------------------------------
# Method 2 — FreeCAD headless (cross-platform)
# ---------------------------------------------------------------------------

_FREECAD_COMMANDS = ["FreeCADCmd", "freecadcmd", "freecad-python3", "FreeCAD"]

_FREECAD_SCRIPT = '''\
import sys, os

sldprt_path = {sldprt_repr}
step_path   = {step_repr}

for _lp in [
    "/usr/lib/freecad/lib",
    "/usr/lib/freecad-python3/lib",
    "/usr/local/lib/freecad/lib",
    "/opt/FreeCAD/lib",
]:
    if os.path.isdir(_lp) and _lp not in sys.path:
        sys.path.insert(0, _lp)

import FreeCAD   # noqa: E402
import Import    # noqa: E402

doc  = FreeCAD.openDocument(sldprt_path)
objs = [o for o in doc.Objects if hasattr(o, "Shape") and not o.Shape.isNull()]
if not objs:
    print("SLDPRT_CONVERT_ERROR: no valid shapes found")
    sys.exit(1)

Import.export(objs, step_path)
print("SLDPRT_CONVERT_OK")
'''


def _find_freecad() -> Optional[str]:
    for cmd in _FREECAD_COMMANDS:
        try:
            r = subprocess.run([cmd, "--version"], capture_output=True, timeout=8)
            if r.returncode == 0:
                return cmd
        except (FileNotFoundError, subprocess.TimeoutExpired):
            continue
    return None


def _convert_via_freecad(sldprt_path: str, step_path: str, temp_dir: str) -> bool:
    """
    Convert using FreeCAD in headless mode.
    Returns True on success, False if FreeCAD is not on PATH.
    """
    freecad_cmd = _find_freecad()
    if not freecad_cmd:
        return False

    script_content = _FREECAD_SCRIPT.format(
        sldprt_repr=repr(sldprt_path),
        step_repr=repr(step_path),
    )

    script_file = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".py", delete=False, dir=temp_dir
        ) as sf:
            script_file = sf.name
            sf.write(script_content)

        logger.info(f"SLDPRT → STEP via {freecad_cmd}: {sldprt_path}")
        result = subprocess.run(
            [freecad_cmd, script_file],
            capture_output=True, text=True, timeout=120,
        )
        combined = (result.stdout or "") + (result.stderr or "")

        if "SLDPRT_CONVERT_OK" in combined and os.path.exists(step_path):
            logger.info(f"FreeCAD conversion successful → {step_path}")
            return True

        logger.warning(f"FreeCAD conversion failed (exit {result.returncode}): {combined[-300:]}")
        return False

    except Exception as exc:
        logger.warning(f"FreeCAD conversion error: {exc}")
        return False
    finally:
        if script_file and os.path.exists(script_file):
            try:
                os.unlink(script_file)
            except OSError:
                pass


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def convert(sldprt_path: str, temp_dir: str) -> str:
    """
    Convert a SolidWorks .sldprt file to STEP format.

    Tries SolidWorks COM automation first (Windows), then FreeCAD.

    Args:
        sldprt_path: Absolute path to the source .sldprt file.
        temp_dir:    Directory where the output .step file is written.

    Returns:
        Absolute path to the generated .step file.

    Raises:
        RuntimeError: No conversion method is available.
    """
    stem      = Path(sldprt_path).stem
    step_path = os.path.join(temp_dir, f"{stem}_from_sldprt.step")

    # --- Method 1: SolidWorks COM (Windows + SolidWorks installed) ----------
    if _convert_via_solidworks(sldprt_path, step_path):
        return step_path

    # --- Method 2: FreeCAD headless -----------------------------------------
    if _convert_via_freecad(sldprt_path, step_path, temp_dir):
        return step_path

    # --- No converter available — give clear, actionable instructions --------
    on_windows = sys.platform == "win32"
    if on_windows:
        raise RuntimeError(
            "Could not convert this SolidWorks file. Tried SolidWorks COM automation and FreeCAD — neither succeeded. "
            "Options:\n"
            "• Export from SolidWorks directly: File → Save As → STEP AP214 (.step)\n"
            "• Install FreeCAD (https://www.freecad.org/) and restart the CAD engine"
        )
    else:
        raise RuntimeError(
            "SolidWorks (.sldprt) files require FreeCAD for conversion on Linux/macOS. "
            "Install FreeCAD (https://www.freecad.org/) and restart the CAD engine, "
            "OR export your part from SolidWorks as STEP (File → Save As → .step)."
        )
