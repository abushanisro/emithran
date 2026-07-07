"""
Knowledge Layer — searchable stores for engineering standards, company rules,
and manufacturing knowledge. Phase 1: keyword index over JSON files.
Phase 2: vector search (pgvector or FAISS).
"""

from __future__ import annotations
import json
import os
import re
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_KB_DIR = Path(os.getenv("COPILOT_KB_DIR", str(Path(__file__).parent.parent / "knowledge")))


@dataclass
class KnowledgeChunk:
    store: str
    title: str
    body: str
    tags: list[str]

    def to_text(self) -> str:
        return f"[{self.store.upper()}] {self.title}: {self.body}"


_LOADED: dict[str, list[KnowledgeChunk]] = {}


def _load_store(name: str) -> list[KnowledgeChunk]:
    if name in _LOADED:
        return _LOADED[name]
    path = _KB_DIR / f"{name}.json"
    if not path.exists():
        logger.debug(f"Knowledge store not found: {path}")
        return []
    try:
        raw: list[dict[str, Any]] = json.loads(path.read_text())
        chunks = [
            KnowledgeChunk(
                store=name,
                title=item.get("title", ""),
                body=item.get("body", ""),
                tags=item.get("tags", []),
            )
            for item in raw
        ]
        _LOADED[name] = chunks
        logger.info(f"Loaded {len(chunks)} knowledge chunks from {name}")
        return chunks
    except Exception as e:
        logger.warning(f"Failed to load knowledge store {name}: {e}")
        return []


_STORE_NAMES = ["engineering_standards", "manufacturing_kb", "company_rules"]


def search(query: str, top_k: int = 4) -> list[KnowledgeChunk]:
    """
    Keyword-based search across all knowledge stores.
    Returns up to top_k most relevant chunks.
    """
    words = set(re.sub(r"[^\w\s]", " ", query.lower()).split())
    if not words:
        return []

    scored: list[tuple[float, KnowledgeChunk]] = []

    for store_name in _STORE_NAMES:
        for chunk in _load_store(store_name):
            haystack = (chunk.title + " " + chunk.body + " " + " ".join(chunk.tags)).lower()
            score = sum(1 for w in words if w in haystack)
            if score > 0:
                scored.append((score, chunk))

    scored.sort(key=lambda x: -x[0])
    return [c for _, c in scored[:top_k]]


def format_for_prompt(chunks: list[KnowledgeChunk]) -> str:
    if not chunks:
        return "No matching standards retrieved."
    return "\n".join(f"• {c.to_text()}" for c in chunks)
