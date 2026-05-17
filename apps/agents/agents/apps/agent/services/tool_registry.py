from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from agents.apps.chat.schemas import McpServerSchema


@dataclass(frozen=True)
class ToolMeta:
    name: str                          # short name (without namespace)
    required_scope: str | None         # None = no scope gate (user-supplied tools default)
    requires_confirmation: bool
    summarize: Callable[[dict[str, object]], str]  # human summary for confirmation_required event
    preview: Callable[[dict[str, object]], dict[str, object]]  # compact args preview


def _truncate(value: object, limit: int = 80) -> str:
    s = str(value)
    return s if len(s) <= limit else s[:limit] + '…'


def _summary_createPage(args: dict[str, object]) -> str:
    return f'Создать страницу «{_truncate(args.get("title"))}»'


def _summary_updatePage(args: dict[str, object]) -> str:
    return f'Перезаписать страницу {args.get("pageId")}'


def _summary_movePage(args: dict[str, object]) -> str:
    return f'Переместить страницу {args.get("pageId")}'


def _summary_uploadFile(args: dict[str, object]) -> str:
    return f'Загрузить файл {_truncate(args.get("fileName"))}'


def _summary_attachFile(args: dict[str, object]) -> str:
    return f'Привязать файл {args.get("fileId")} к странице {args.get("pageId")}'


def _summary_createPageFromFile(args: dict[str, object]) -> str:
    return f'Создать страницу из файла {args.get("fileId")}'


def _summary_generic(name: str) -> Callable[[dict[str, object]], str]:
    return lambda args: f'Вызвать {name}({", ".join(args.keys())})'


def _preview_default(args: dict[str, object]) -> dict[str, object]:
    return {k: _truncate(v, 200) for k, v in args.items() if k not in ('contentBase64',)}


DEFAULT_ENGINES_TOOLS: dict[str, ToolMeta] = {
    'getWorkspaceStats': ToolMeta('getWorkspaceStats', 'pages:read', False,
                                   _summary_generic('getWorkspaceStats'), _preview_default),
    'getPageMarkdown':   ToolMeta('getPageMarkdown', 'pages:read', False,
                                   _summary_generic('getPageMarkdown'), _preview_default),
    'getPageStats':      ToolMeta('getPageStats', 'pages:read', False,
                                   _summary_generic('getPageStats'), _preview_default),
    'listSkills':        ToolMeta('listSkills', 'pages:read', False,
                                   _summary_generic('listSkills'), _preview_default),
    'listAgents':        ToolMeta('listAgents', 'pages:read', False,
                                   _summary_generic('listAgents'), _preview_default),
    'listWorkspaceFiles': ToolMeta('listWorkspaceFiles', 'files:read', False,
                                    _summary_generic('listWorkspaceFiles'), _preview_default),
    'listPageFiles':     ToolMeta('listPageFiles', 'files:read', False,
                                   _summary_generic('listPageFiles'), _preview_default),
    'search_pages':      ToolMeta('search_pages', 'search:query', False,
                                   _summary_generic('search_pages'), _preview_default),
    'createPage':        ToolMeta('createPage', 'pages:write', True,
                                   _summary_createPage, _preview_default),
    'updatePage':        ToolMeta('updatePage', 'pages:write', True,
                                   _summary_updatePage, _preview_default),
    'movePage':          ToolMeta('movePage', 'pages:write', True,
                                   _summary_movePage, _preview_default),
    'createPageFromFile': ToolMeta('createPageFromFile', 'pages:write', True,
                                    _summary_createPageFromFile, _preview_default),
    'uploadFileToPage':  ToolMeta('uploadFileToPage', 'files:write', True,
                                   _summary_uploadFile, _preview_default),
    'uploadImageToPage': ToolMeta('uploadImageToPage', 'files:write', True,
                                   _summary_uploadFile, _preview_default),
    'attachFileToPage':  ToolMeta('attachFileToPage', 'files:write', True,
                                   _summary_attachFile, _preview_default),
    'attachImageToPage': ToolMeta('attachImageToPage', 'files:write', True,
                                   _summary_attachFile, _preview_default),
    # agents-internal tools
    'save_memory': ToolMeta('save_memory', 'memory:write', False,
                             _summary_generic('save_memory'), _preview_default),
    'recall_memory': ToolMeta('recall_memory', 'memory:read', False,
                               _summary_generic('recall_memory'), _preview_default),
}


def build_registry_for_servers(
    servers: list[McpServerSchema],
    discovered: dict[str, list[str]] | None = None,
) -> dict[str, ToolMeta]:
    """Return a ``{namespaced_name: ToolMeta}`` map for all known tools.

    For the default engines server, metadata comes from ``DEFAULT_ENGINES_TOOLS``.
    For user-supplied servers, every tool defaults to requiring confirmation
    with no scope gate (the JWT still controls feature access at the web layer).
    """
    registry: dict[str, ToolMeta] = {}
    for short_name, meta in DEFAULT_ENGINES_TOOLS.items():
        registry[f'anynote__{short_name}'] = meta
    if discovered:
        for server_name, tool_names in discovered.items():
            for tool_name in tool_names:
                registry[f'{server_name}__{tool_name}'] = ToolMeta(
                    name=tool_name,
                    required_scope=None,
                    requires_confirmation=True,
                    summarize=_summary_generic(f'{server_name}.{tool_name}'),
                    preview=_preview_default,
                )
    return registry
