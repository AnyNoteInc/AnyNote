"""Render chat prompts from the repository template."""

from __future__ import annotations

from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape

from agents.apps.chat.schemas import GenerateRequest

_TEMPLATE_DIR = Path(__file__).resolve().parents[3] / "prompts"
_TEMPLATE_NAME = "default.j2"


class JinjaRenderer:
    """Render the default Jinja prompt for chat payloads."""

    def __init__(self, template_dir: Path | None = None) -> None:
        self._env = Environment(
            loader=FileSystemLoader(str(template_dir or _TEMPLATE_DIR)),
            autoescape=select_autoescape(enabled_extensions=(), default=False),
            undefined=StrictUndefined,
            keep_trailing_newline=True,
        )

    def render(self, payload: GenerateRequest) -> str:
        template = self._env.get_template(_TEMPLATE_NAME)
        return template.render(
            payload=payload,
            model=payload.model,
            instructions=getattr(payload, "instructions", None),
            rag=getattr(payload, "rag", None),
            conversation=payload.conversation,
            skills=getattr(payload, "skills", []),
            agents=getattr(payload, "agents", []),
            mcp=getattr(payload, "mcp", None),
            user_request=payload.user_request,
        )
