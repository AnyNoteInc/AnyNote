from __future__ import annotations

from pathlib import Path
from os.path import join

from jinja2 import Environment, FileSystemLoader

from agents.settings import SettingsSchema

from ..schemas import QueryRequestSchema


class JinjaRendererRepository:
    """Render the default Jinja prompt for chat payloads."""

    TEMPLATE_NAME = 'default.j2'

    def __init__(self, settings: SettingsSchema) -> None:
        path = join(settings.base_dir, 'agents', 'apps', 'chat', 'templates')
        self.environment = Environment(loader=FileSystemLoader(path))

    def render(self, context: QueryRequestSchema) -> str:
        template = self.environment.get_template(self.TEMPLATE_NAME)
        return template.render(**context.model_dump(mode='json'))
