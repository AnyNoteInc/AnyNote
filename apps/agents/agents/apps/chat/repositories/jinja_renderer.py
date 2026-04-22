from __future__ import annotations

from os.path import join

from jinja2 import Environment, FileSystemLoader

from agents.settings import SettingsSchema

from ..schemas import McpServerToolsSchema, QueryRequestSchema


class JinjaRendererRepository:
    """Render the default Jinja prompt for chat payloads."""

    TEMPLATE_NAME = 'default.j2'

    def __init__(self, settings: SettingsSchema) -> None:
        path = join(settings.base_dir, 'agents', 'apps', 'chat', 'templates')
        self.environment = Environment(loader=FileSystemLoader(path))
        self.template = self.environment.get_template(self.TEMPLATE_NAME)

    def render(self, context: QueryRequestSchema, mcp_servers: list[McpServerToolsSchema]) -> str:
        return self.template.render(**{
            **context.model_dump(mode='json'),
            'mcp_servers': mcp_servers,
        })
