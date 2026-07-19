"""
Planner — keyword-based bucket classifier (zero-latency, no LLM call).
Identifies which data buckets are relevant to the user's question so the
Context Builder can trim the context JSON before sending it to Groq.

Phase 2: replace keyword rules with a fast llama-3.1-8b-instant call.
"""

from __future__ import annotations
import re

BUCKET_KEYWORDS: dict[str, list[str]] = {
    "cost": [
        "expensive", "cost", "price", "reduce", "save", "cheapest", "cheap",
        "quote", "money", "dollar", "usd", "inr", "total", "breakdown", "rate",
        "hourly", "mhr", "lhr", "labour", "material cost",
    ],
    "geometry": [
        "clamp", "wall", "draft", "rib", "boss", "hole", "dimension", "size",
        "thickness", "length", "width", "height", "volume", "surface",
        "projected area", "bounding box", "weight", "mass",
    ],
    "dfm": [
        "dfm", "warning", "undraft", "redesign", "manufacturability",
        "design", "improve", "fix", "issue", "problem", "change", "modify",
        "sink", "warp", "shrink", "gate", "flash", "ejection", "parting",
    ],
    "machine": [
        "machine", "press", "molder", "500t", "200t", "150t", "100t",
        "clamp force", "tie bar", "platen", "barrel", "shot", "tonnage",
        "injection", "cycle", "throughput", "utilisation",
    ],
    "sustain": [
        "co2", "carbon", "sustainability", "waste", "energy", "green",
        "environment", "emission", "footprint", "recyclability", "scrap",
        "lifecycle", "eco",
    ],
    "invest": [
        "tooling", "nre", "mold cost", "mould cost", "investment",
        "amortize", "amortise", "roi", "break even", "breakeven",
        "payback", "fixture", "jig", "programming cost",
    ],
    "scenario": [
        "what if", "simulate", "instead of", "compare", "alternative",
        "switch", "change material", "different", "scenario", "option",
        "other", "india", "china", "usa", "europe", "factory", "location",
        "volume", "batch", "quantity", "2 cavity", "two cavity",
    ],
    "knowledge": [
        "standard", "rule", "specification", "spec", "iso", "asme", "spi",
        "din", "mil", "astm", "best practice", "guideline", "allowable",
        "recommendation", "why", "explain", "how does", "what is",
    ],
    "vendor": [
        "vendor", "supplier", "rfq", "source", "sourcing", "who can make",
        "who is good", "best vendor", "best supplier", "recommend vendor",
        "good vendor", "shortlist", "supply chain", "procurement",
        "capability", "capacity", "lead time",
    ],
}

# Always include these buckets regardless of question content
ALWAYS_INCLUDE = {"cost", "geometry"}


def classify(message: str) -> list[str]:
    """Return the list of bucket names relevant to the user's message."""
    msg = message.lower()
    buckets: set[str] = set(ALWAYS_INCLUDE)

    for bucket, keywords in BUCKET_KEYWORDS.items():
        for kw in keywords:
            if re.search(r"\b" + re.escape(kw) + r"\b", msg):
                buckets.add(bucket)
                break

    return sorted(buckets)
