from agents.apps.agent.services.tool_registry import (
    DEFAULT_ENGINES_TOOLS,
    build_registry_for_servers,
)


def test_engines_read_only_tools_do_not_require_confirmation() -> None:
    registry = build_registry_for_servers()
    meta = registry['anynote__getPageMarkdown']
    assert meta.requires_confirmation is False
    assert meta.required_scope == 'pages:read'


def test_engines_destructive_tools_require_confirmation() -> None:
    registry = build_registry_for_servers()
    meta = registry['anynote__createPage']
    assert meta.requires_confirmation is True
    assert meta.required_scope == 'pages:write'


def test_user_server_tool_defaults_to_requiring_confirmation() -> None:
    registry = build_registry_for_servers(discovered={'Notion': ['createDocument']})
    meta = registry['Notion__createDocument']
    assert meta.requires_confirmation is True
    assert meta.required_scope is None


def test_summarize_render_includes_tool_arg_preview() -> None:
    meta = DEFAULT_ENGINES_TOOLS['createPage']
    summary = meta.summarize({'title': 'План проекта', 'parentId': 'p1'})
    assert 'План проекта' in summary


def test_file_tools_registered_with_scopes_and_confirmation() -> None:
    assert DEFAULT_ENGINES_TOOLS['list_files'].required_scope == 'files:read'
    assert DEFAULT_ENGINES_TOOLS['search_files'].required_scope == 'files:read'
    assert DEFAULT_ENGINES_TOOLS['get_file_download_link'].required_scope == 'files:read'
    assert DEFAULT_ENGINES_TOOLS['get_file_content'].required_scope == 'files:read'
    for read_tool in ('list_files', 'search_files', 'get_file_download_link', 'get_file_content'):
        assert DEFAULT_ENGINES_TOOLS[read_tool].requires_confirmation is False
    delete = DEFAULT_ENGINES_TOOLS['delete_file']
    assert delete.required_scope == 'files:delete'
    assert delete.requires_confirmation is True
