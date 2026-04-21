
from os.path import join
from jinja2 import Environment, FileSystemLoader
from agents.settings import SettingsSchema

from ..schemas import QueryRequestSchema

class JinjaRendererRepository:
    """Render the default Jinja prompt for chat payloads."""

    TEMPLATE_NAME = 'default.j2'

    def __init__(self, settings: SettingsSchema) -> None:
        template_dir = join(settings.base_dir, "agents", "apps", "chat", "repositories", "templates")
        self.enviroment = Environment(loader=FileSystemLoader(template_dir))

    def render(self, context: QueryRequestSchema) -> str:
        template = self.enviroment.get_template(self.TEMPLATE_NAME)
        return template.render(context=context, model=context.model)
