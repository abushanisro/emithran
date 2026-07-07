"""Knowledge layer tool — searches engineering standards and manufacturing KB."""

from __future__ import annotations
from typing import Any
from copilot.registry import register_tool
import copilot.knowledge as kb


async def _search_engineering_standards(ctx: dict, query: str = "", **_) -> dict[str, Any]:
    chunks = kb.search(query, top_k=4)
    results = [{"store": c.store, "title": c.title, "body": c.body} for c in chunks]
    return {
        "query": query,
        "results": results,
        "count": len(results),
        "source": "knowledge_layer",
    }


async def _get_process_explanation(ctx: dict, process_name: str = "", **_) -> dict[str, Any]:
    _PROCESS_KB: dict[str, str] = {
        "injection moulding": (
            "Injection moulding forces molten polymer into a closed steel mould under high pressure. "
            "Cycle = fill + pack/hold + cool + eject. Dominant cost drivers: mould tool amortisation, "
            "machine clamp force (function of projected area × cavity pressure), and cooling time "
            "(proportional to wall thickness²). Gate location determines weld-line position and "
            "surface finish. Engineering resins (PA, PC, POM) require hot-runner systems to prevent degradation."
        ),
        "sheet metal laser cutting": (
            "Fiber lasers cut 2D profiles by melting/vaporising material with an assist gas (N₂ or O₂). "
            "Speed is inversely proportional to material thickness. Kerf width ≈ 0.2–0.3 mm for 1 kW/mm² power density. "
            "Nest efficiency (material utilisation) directly impacts material cost. "
            "Nitrogen cutting leaves oxide-free edges suitable for anodising or powder coat."
        ),
        "cnc milling": (
            "Subtractive process removing material with rotating end-mills. "
            "Cost = setup + (machining time × MHR). Machining time dominated by depth of cut, "
            "feed rate, and surface area. 5-axis reduces setups for complex parts. "
            "Tight tolerances (±0.01 mm) require finishing passes and increase cycle time significantly."
        ),
        "die casting": (
            "Molten metal (Al, Zn, Mg) injected into a hardened steel die at 20–100 MPa. "
            "Cycle time 15–60 s depending on wall thickness and alloy. "
            "Min wall: Al 1.0 mm, Zn 0.4 mm. Draft 1–3° required. "
            "High tooling cost ($30k–$150k) but very low piece cost at volume."
        ),
        "cnc turning": (
            "Rotates the workpiece while a fixed tool removes material. Ideal for axisymmetric parts. "
            "Turning centres with live tooling can mill, drill, and thread without re-fixturing. "
            "Cycle time ≈ volume removed ÷ MRR. Surface finish Ra 0.8–3.2 µm standard."
        ),
    }

    key = process_name.lower().strip()
    for proc_key, explanation in _PROCESS_KB.items():
        if proc_key in key or key in proc_key:
            return {"process": process_name, "explanation": explanation, "source": "manufacturing_kb"}

    return {
        "process": process_name,
        "explanation": f"Process '{process_name}' not found in local KB. Try searching engineering standards.",
        "source": "manufacturing_kb",
    }


register_tool(
    name="search_engineering_standards",
    description=(
        "Searches engineering standards (SPI, ASME, ISO, DIN, MIL, ASTM) and manufacturing "
        "knowledge base for rules, limits, and guidelines relevant to the query. "
        "Use when the user asks about standards, design rules, or tolerances."
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search query, e.g. 'draft angle injection molding' or 'sheet metal bend radius'",
            }
        },
        "required": ["query"],
    },
    handler=_search_engineering_standards,
)

register_tool(
    name="get_process_explanation",
    description=(
        "Returns a concise engineering explanation of a manufacturing process: "
        "how it works, key cost drivers, design rules, and typical capabilities. "
        "Supported: injection moulding, sheet metal laser cutting, CNC milling, "
        "die casting, CNC turning."
    ),
    parameters={
        "type": "object",
        "properties": {
            "process_name": {
                "type": "string",
                "description": "Name of the manufacturing process to explain.",
            }
        },
        "required": ["process_name"],
    },
    handler=_get_process_explanation,
)
