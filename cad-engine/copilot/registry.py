"""
Tool Registry — every copilot tool self-registers here at import time.
The agent reads TOOL_REGISTRY to discover tools dynamically; no changes
needed here when adding new manufacturing families or capabilities.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Callable, Coroutine


@dataclass
class ToolDef:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[..., Coroutine[Any, Any, Any]]

    def to_openai_spec(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


TOOL_REGISTRY: dict[str, ToolDef] = {}


def register_tool(
    name: str,
    description: str,
    parameters: dict[str, Any],
    handler: Callable[..., Coroutine[Any, Any, Any]],
) -> None:
    TOOL_REGISTRY[name] = ToolDef(
        name=name,
        description=description,
        parameters=parameters,
        handler=handler,
    )


def get_openai_tools() -> list[dict[str, Any]]:
    """Return all registered tools in OpenAI/Groq tool spec format."""
    return [t.to_openai_spec() for t in TOOL_REGISTRY.values()]
