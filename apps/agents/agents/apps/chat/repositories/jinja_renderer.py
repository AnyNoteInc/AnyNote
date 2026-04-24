from __future__ import annotations

from os.path import join

from jinja2 import Environment, FileSystemLoader

from agents.settings import SettingsSchema

from ..schemas import McpServerToolsSchema, QueryRequestSchema, RagDocumentSchema


class JinjaRendererRepository:
    """Render the default Jinja prompt for chat payloads."""

    TEMPLATE_NAME = 'default.j2'

    def __init__(self, settings: SettingsSchema) -> None:
        path = join(settings.base_dir, 'agents', 'apps', 'chat', 'templates')
        self.environment = Environment(loader=FileSystemLoader(path))

    def render(
        self,
        context: QueryRequestSchema,
        mcp_servers: list[McpServerToolsSchema],
        rag_documents: list[RagDocumentSchema],
    ) -> str:
        template = self.environment.get_template(self.TEMPLATE_NAME)
        rag_payload = None
        if rag_documents:
            rag_payload = {
                'documents': [d.model_dump(mode='json', by_alias=False) for d in rag_documents]
            }
        context_data = context.model_dump(mode='json')
        # Override payload.rag with the retrieval result (source of truth at render time)
        context_data['rag'] = rag_payload
        return template.render(**{
            **context_data,
            'mcp_servers': mcp_servers,
        })
