"""
Engineering Memory — persists per-user/project engineering preferences
across sessions. Phase 1: JSON file on disk. Phase 2: DB table.

Memory is advice-only — it never overrides engine-computed figures.
"""

from __future__ import annotations
import json
import os
import logging
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_MEMORY_DIR = Path(os.getenv("COPILOT_MEMORY_DIR", "/tmp/copilot_memory"))
_MEMORY_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class EngineeringMemory:
    priorities: list[str] = field(default_factory=list)
    # e.g. ["weight < cost", "no China sourcing", "prefer automated processes"]
    constraints: list[str] = field(default_factory=list)
    # e.g. ["must pass AS9100", "max cycle time 45s", "lead time < 6 weeks"]
    preferences: dict[str, str] = field(default_factory=dict)
    # e.g. {"preferred_material": "PA66", "preferred_factory": "USA"}

    def is_empty(self) -> bool:
        return not self.priorities and not self.constraints and not self.preferences

    def to_prompt_text(self) -> str:
        if self.is_empty():
            return "No engineering preferences recorded yet."
        lines = []
        if self.priorities:
            lines.append("Priorities: " + "; ".join(self.priorities))
        if self.constraints:
            lines.append("Hard constraints: " + "; ".join(self.constraints))
        if self.preferences:
            prefs = ", ".join(f"{k}={v}" for k, v in self.preferences.items())
            lines.append("Preferences: " + prefs)
        return "\n".join(lines)


def _key(user_id: str, project_id: str) -> str:
    safe_user = "".join(c for c in user_id if c.isalnum() or c in "-_")[:64]
    safe_proj = "".join(c for c in project_id if c.isalnum() or c in "-_")[:64]
    return f"{safe_user}__{safe_proj}"


def load(user_id: str, project_id: str) -> EngineeringMemory:
    path = _MEMORY_DIR / f"{_key(user_id, project_id)}.json"
    if not path.exists():
        return EngineeringMemory()
    try:
        data = json.loads(path.read_text())
        return EngineeringMemory(
            priorities=data.get("priorities", []),
            constraints=data.get("constraints", []),
            preferences=data.get("preferences", {}),
        )
    except Exception as e:
        logger.warning(f"Failed to load engineering memory: {e}")
        return EngineeringMemory()


def save(user_id: str, project_id: str, mem: EngineeringMemory) -> None:
    path = _MEMORY_DIR / f"{_key(user_id, project_id)}.json"
    try:
        path.write_text(json.dumps(asdict(mem), indent=2))
    except Exception as e:
        logger.warning(f"Failed to save engineering memory: {e}")


def update_from_message(
    user_id: str,
    project_id: str,
    message: str,
) -> tuple[EngineeringMemory, bool]:
    """
    Detect 'remember…' / 'always prefer…' intent in message and update memory.
    Returns (memory, was_updated).
    """
    mem = load(user_id, project_id)
    msg_lower = message.lower()
    updated = False

    remember_triggers = ["remember that", "remember:", "always prefer", "always use",
                         "never use", "don't use", "constraint:", "priority:"]
    if any(t in msg_lower for t in remember_triggers):
        # Strip trigger words and add as a priority
        cleaned = message.strip()
        for t in ["Remember that", "Remember:", "Always prefer", "Always use",
                  "Never use", "Don't use", "Constraint:", "Priority:",
                  "remember that", "remember:", "always prefer", "always use",
                  "never use", "don't use", "constraint:", "priority:"]:
            cleaned = cleaned.replace(t, "").strip().strip(".")
        if cleaned and cleaned not in mem.priorities:
            mem.priorities.append(cleaned)
            save(user_id, project_id, mem)
            updated = True

    return mem, updated
