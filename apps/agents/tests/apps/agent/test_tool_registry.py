from agents.apps.agent.services.tool_registry import (
    DEFAULT_ENGINES_TOOLS,
    SCOPE_FILES_DELETE,
    SCOPE_FILES_WRITE,
    SCOPE_KANBAN_WRITE,
    SCOPE_PAGES_WRITE,
    SCOPE_REMINDERS_WRITE,
    build_registry_for_servers,
)

# Scopes whose tools must participate in the page-binding gate.
_PAGE_BINDING_GUARDED_SCOPES = frozenset({
    SCOPE_PAGES_WRITE,
    SCOPE_FILES_WRITE,
    SCOPE_FILES_DELETE,
    SCOPE_REMINDERS_WRITE,
    SCOPE_KANBAN_WRITE,
})

# Write tools consciously exempt from the page-binding arg gate. These
# reference their target by reminderId/taskId/sprintId (or resolve a default
# board server-side when the optional boardPageId is omitted), so arg-equality
# against the bound page id cannot gate them here — apps/engines resolves the
# real target page server-side, and resolution-based gating there is a
# deliberate follow-up. Do NOT tag kanban tools with page_arg='boardPageId':
# the arg is optional and a strict equality check would deny legitimate calls
# that omit it. Add a name here ONLY with a justification.
_PAGE_BINDING_EXEMPT: frozenset[str] = frozenset({
    # reminders: mutate by reminderId (deleteReminder also takes bulk selectors)
    'moveReminder',
    'deleteReminder',
    'completeReminder',
    # kanban: mutate by taskId/sprintId; boardPageId is optional
    'createTask',
    'moveTaskToStatus',
    'assignTask',
    'unassignTask',
    'setTaskDates',
    'setTaskSprint',
    'setTaskPriority',
    'setTaskType',
    'cancelTask',
    'addTaskComment',
    'createSprint',
    'startSprint',
    'closeSprint',
})


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


def test_every_page_or_file_write_tool_participates_in_page_binding() -> None:
    """Drift guard: a new write tool in a guarded scope must be tagged for
    the page-binding gate (page_arg or forbidden_when_page_bound) so it
    cannot silently modify pages outside a page-bound chat's page."""
    for name, meta in DEFAULT_ENGINES_TOOLS.items():
        if meta.required_scope not in _PAGE_BINDING_GUARDED_SCOPES:
            continue
        if name in _PAGE_BINDING_EXEMPT:
            continue
        assert meta.page_arg is not None or meta.forbidden_when_page_bound, (
            f'{name} is a write tool in a page-binding-guarded scope but is '
            f'not tagged for the gate; set page_arg or forbidden_when_page_bound '
            f'(or add it to _PAGE_BINDING_EXEMPT with a justification)'
        )


def test_page_binding_exempt_names_exist_in_registry() -> None:
    """Keep the allowlist honest: every exempted name must be a real tool."""
    for name in _PAGE_BINDING_EXEMPT:
        assert name in DEFAULT_ENGINES_TOOLS, f'{name} exempted but not registered'


def test_page_binding_tags_on_representative_tools() -> None:
    assert DEFAULT_ENGINES_TOOLS['updatePage'].page_arg == 'pageId'
    assert DEFAULT_ENGINES_TOOLS['createReminder'].page_arg == 'pageId'
    assert DEFAULT_ENGINES_TOOLS['createPage'].forbidden_when_page_bound is True
    assert DEFAULT_ENGINES_TOOLS['delete_file'].forbidden_when_page_bound is True
    # Read tools stay untagged — reads are unrestricted in page-bound chats.
    assert DEFAULT_ENGINES_TOOLS['getPageMarkdown'].page_arg is None
    assert DEFAULT_ENGINES_TOOLS['getPageMarkdown'].forbidden_when_page_bound is False


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
