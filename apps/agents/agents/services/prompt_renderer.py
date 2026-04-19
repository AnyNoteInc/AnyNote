"""Renders the default Jinja prompt from a GenerateRequest payload."""

from __future__ import annotations

from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape

from agents.schemas.generate import GenerateRequest

_TEMPLATE_DIR = Path(__file__).parent.parent / "prompts"
_TEMPLATE_NAME = "default.j2"


class JinjaRenderer:
    """Renders the service's prompt template against GenerateRequest payloads."""

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
            model=payload.model,
            instructions=payload.instructions,
            rag=payload.rag,
            conversation=payload.conversation,
            skills=payload.skills,
            agents=payload.agents,
            mcp=payload.mcp,
            user_request=payload.user_request,
        )
