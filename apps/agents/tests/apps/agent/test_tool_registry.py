from agents.apps.agent.services.tool_registry import (
    DEFAULT_ENGINES_TOOLS,
    build_registry_for_servers,
)
from agents.apps.chat.schemas import McpServerSchema


def test_engines_read_only_tools_do_not_require_confirmation() -> None:
    registry = build_registry_for_servers([])
    meta = registry['anynote__getPageMarkdown']
    assert meta.requires_confirmation is False
    assert meta.required_scope == 'pages:read'


def test_engines_destructive_tools_require_confirmation() -> None:
    registry = build_registry_for_servers([])
    meta = registry['anynote__createPage']
    assert meta.requires_confirmation is True
    assert meta.required_scope == 'pages:write'


def test_user_server_tool_defaults_to_requiring_confirmation() -> None:
    server = McpServerSchema(name='Notion', url='https://x', description='', headers={}, tools=[])
    registry = build_registry_for_servers([server], discovered={'Notion': ['createDocument']})
    meta = registry['Notion__createDocument']
    assert meta.requires_confirmation is True
    assert meta.required_scope is None


def test_summarize_render_includes_tool_arg_preview() -> None:
    meta = DEFAULT_ENGINES_TOOLS['createPage']
    summary = meta.summarize({'title': 'План проекта', 'parentId': 'p1'})
    assert 'План проекта' in summary
