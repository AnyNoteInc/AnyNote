from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

SCOPE_PAGES_READ = 'pages:read'
SCOPE_WORKSPACES_READ = 'workspaces:read'
SCOPE_PAGES_WRITE = 'pages:write'
SCOPE_FILES_READ = 'files:read'
SCOPE_FILES_WRITE = 'files:write'
SCOPE_SEARCH_QUERY = 'search:query'
SCOPE_MEMORY_READ = 'memory:read'
SCOPE_MEMORY_WRITE = 'memory:write'
SCOPE_REMINDERS_READ = 'reminders:read'
SCOPE_REMINDERS_WRITE = 'reminders:write'
SCOPE_NOTIFICATIONS_READ = 'notifications:read'
SCOPE_NOTIFICATIONS_WRITE = 'notifications:write'
SCOPE_FAVORITES_READ = 'favorites:read'
SCOPE_FAVORITES_WRITE = 'favorites:write'
SCOPE_KANBAN_READ = 'kanban:read'
SCOPE_KANBAN_WRITE = 'kanban:write'


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


def _summary_create_page(args: dict[str, object]) -> str:
    return f'Создать страницу «{_truncate(args.get("title"))}»'


def _summary_update_page(args: dict[str, object]) -> str:
    return f'Перезаписать страницу {args.get("pageId")}'


def _summary_move_page(args: dict[str, object]) -> str:
    return f'Переместить страницу {args.get("pageId")}'


def _summary_upload_file(args: dict[str, object]) -> str:
    return f'Загрузить файл {_truncate(args.get("fileName"))}'


def _summary_attach_file(args: dict[str, object]) -> str:
    return f'Привязать файл {args.get("fileId")} к странице {args.get("pageId")}'


def _summary_create_page_from_file(args: dict[str, object]) -> str:
    return f'Создать страницу из файла {args.get("fileId")}'


def _summary_generic(name: str) -> Callable[[dict[str, object]], str]:
    return lambda args: f'Вызвать {name}({", ".join(args.keys())})'


def _preview_default(args: dict[str, object]) -> dict[str, object]:
    return {k: _truncate(v, 200) for k, v in args.items() if k not in ('contentBase64',)}


DEFAULT_ENGINES_TOOLS: dict[str, ToolMeta] = {
    'list_workspaces': ToolMeta('list_workspaces', SCOPE_WORKSPACES_READ, False,
                                 _summary_generic('list_workspaces'), _preview_default),
    'listWorkspaceMembers': ToolMeta('listWorkspaceMembers', SCOPE_WORKSPACES_READ, False,
                                      _summary_generic('listWorkspaceMembers'), _preview_default),
    'getWorkspaceStats': ToolMeta('getWorkspaceStats', SCOPE_PAGES_READ, False,
                                   _summary_generic('getWorkspaceStats'), _preview_default),
    'getPageMarkdown':   ToolMeta('getPageMarkdown', SCOPE_PAGES_READ, False,
                                   _summary_generic('getPageMarkdown'), _preview_default),
    'getPageStats':      ToolMeta('getPageStats', SCOPE_PAGES_READ, False,
                                   _summary_generic('getPageStats'), _preview_default),
    'listSkills':        ToolMeta('listSkills', SCOPE_PAGES_READ, False,
                                   _summary_generic('listSkills'), _preview_default),
    'listAgents':        ToolMeta('listAgents', SCOPE_PAGES_READ, False,
                                   _summary_generic('listAgents'), _preview_default),
    'listWorkspaceFiles': ToolMeta('listWorkspaceFiles', SCOPE_FILES_READ, False,
                                    _summary_generic('listWorkspaceFiles'), _preview_default),
    'listPageFiles':     ToolMeta('listPageFiles', SCOPE_FILES_READ, False,
                                   _summary_generic('listPageFiles'), _preview_default),
    'search_pages':      ToolMeta('search_pages', SCOPE_SEARCH_QUERY, False,
                                   _summary_generic('search_pages'), _preview_default),
    'searchPagesByTitle': ToolMeta('searchPagesByTitle', SCOPE_PAGES_READ, False,
                                    _summary_generic('searchPagesByTitle'), _preview_default),
    'listPages':         ToolMeta('listPages', SCOPE_PAGES_READ, False,
                                  _summary_generic('listPages'), _preview_default),
    'createPage':        ToolMeta('createPage', SCOPE_PAGES_WRITE, True,
                                   _summary_create_page, _preview_default),
    'updatePage':        ToolMeta('updatePage', SCOPE_PAGES_WRITE, True,
                                   _summary_update_page, _preview_default),
    'movePage':          ToolMeta('movePage', SCOPE_PAGES_WRITE, True,
                                   _summary_move_page, _preview_default),
    'appendToPage':      ToolMeta('appendToPage', SCOPE_PAGES_WRITE, True,
                                   lambda a: f'Дописать в страницу {a.get("pageId")}', _preview_default),
    'archivePage':       ToolMeta('archivePage', SCOPE_PAGES_WRITE, True,
                                   lambda a: f'Архивировать страницу {a.get("pageId")}', _preview_default),
    'restorePage':       ToolMeta('restorePage', SCOPE_PAGES_WRITE, True,
                                   lambda a: f'Восстановить страницу {a.get("pageId")}', _preview_default),
    'createPageFromFile': ToolMeta('createPageFromFile', SCOPE_PAGES_WRITE, True,
                                    _summary_create_page_from_file, _preview_default),
    'uploadFileToPage':  ToolMeta('uploadFileToPage', SCOPE_FILES_WRITE, True,
                                   _summary_upload_file, _preview_default),
    'uploadImageToPage': ToolMeta('uploadImageToPage', SCOPE_FILES_WRITE, True,
                                   _summary_upload_file, _preview_default),
    'attachFileToPage':  ToolMeta('attachFileToPage', SCOPE_FILES_WRITE, True,
                                   _summary_attach_file, _preview_default),
    'attachImageToPage': ToolMeta('attachImageToPage', SCOPE_FILES_WRITE, True,
                                   _summary_attach_file, _preview_default),
    'createReminder':   ToolMeta('createReminder', SCOPE_REMINDERS_WRITE, True,
                                  lambda a: f'Создать напоминание на странице {a.get("pageId")}', _preview_default),
    'listReminders':    ToolMeta('listReminders', SCOPE_REMINDERS_READ, False,
                                  _summary_generic('listReminders'), _preview_default),
    'moveReminder':     ToolMeta('moveReminder', SCOPE_REMINDERS_WRITE, True,
                                  lambda a: f'Перенести напоминание {a.get("reminderId")}', _preview_default),
    'deleteReminder':   ToolMeta('deleteReminder', SCOPE_REMINDERS_WRITE, True,
                                  lambda a: 'Удалить напоминания', _preview_default),
    'completeReminder': ToolMeta('completeReminder', SCOPE_REMINDERS_WRITE, False,
                                  _summary_generic('completeReminder'), _preview_default),
    'listNotifications':     ToolMeta('listNotifications', SCOPE_NOTIFICATIONS_READ, False,
                                       _summary_generic('listNotifications'), _preview_default),
    'markNotificationsRead': ToolMeta('markNotificationsRead', SCOPE_NOTIFICATIONS_WRITE, False,
                                       _summary_generic('markNotificationsRead'), _preview_default),
    'listFavorites':  ToolMeta('listFavorites', SCOPE_FAVORITES_READ, False,
                                _summary_generic('listFavorites'), _preview_default),
    'addFavorite':    ToolMeta('addFavorite', SCOPE_FAVORITES_WRITE, False,
                                _summary_generic('addFavorite'), _preview_default),
    'removeFavorite': ToolMeta('removeFavorite', SCOPE_FAVORITES_WRITE, False,
                                _summary_generic('removeFavorite'), _preview_default),
    'createDiagramPage':  ToolMeta('createDiagramPage', SCOPE_PAGES_WRITE, True,
                                    lambda a: f'Создать {a.get("kind")}-диаграмму «{_truncate(a.get("title"))}»', _preview_default),
    'updateDiagramSource': ToolMeta('updateDiagramSource', SCOPE_PAGES_WRITE, True,
                                     lambda a: f'Обновить диаграмму {a.get("pageId")}', _preview_default),
    # kanban tools
    'listKanbanBoards': ToolMeta('listKanbanBoards', SCOPE_KANBAN_READ, False,
                                  _summary_generic('listKanbanBoards'), _preview_default),
    'listSprints':      ToolMeta('listSprints', SCOPE_KANBAN_READ, False,
                                  _summary_generic('listSprints'), _preview_default),
    'getActiveSprint':  ToolMeta('getActiveSprint', SCOPE_KANBAN_READ, False,
                                  _summary_generic('getActiveSprint'), _preview_default),
    'listTasks':        ToolMeta('listTasks', SCOPE_KANBAN_READ, False,
                                  _summary_generic('listTasks'), _preview_default),
    'getTask':          ToolMeta('getTask', SCOPE_KANBAN_READ, False,
                                  _summary_generic('getTask'), _preview_default),
    'createTask':       ToolMeta('createTask', SCOPE_KANBAN_WRITE, True,
                                  lambda a: f'Создать задачу «{_truncate(a.get("title"))}»', _preview_default),
    'moveTaskToStatus': ToolMeta('moveTaskToStatus', SCOPE_KANBAN_WRITE, True,
                                  lambda a: f'Переместить задачу {a.get("taskId")} в статус', _preview_default),
    'assignTask':       ToolMeta('assignTask', SCOPE_KANBAN_WRITE, True,
                                  lambda a: f'Назначить исполнителя задачи {a.get("taskId")}', _preview_default),
    'unassignTask':     ToolMeta('unassignTask', SCOPE_KANBAN_WRITE, True,
                                  lambda a: f'Снять исполнителя задачи {a.get("taskId")}', _preview_default),
    'setTaskDates':     ToolMeta('setTaskDates', SCOPE_KANBAN_WRITE, True,
                                  lambda a: f'Установить даты задачи {a.get("taskId")}', _preview_default),
    'setTaskSprint':    ToolMeta('setTaskSprint', SCOPE_KANBAN_WRITE, True,
                                  lambda a: f'Установить спринт задачи {a.get("taskId")}', _preview_default),
    'setTaskPriority':  ToolMeta('setTaskPriority', SCOPE_KANBAN_WRITE, True,
                                  lambda a: f'Установить приоритет задачи {a.get("taskId")}', _preview_default),
    'setTaskType':      ToolMeta('setTaskType', SCOPE_KANBAN_WRITE, True,
                                  lambda a: f'Установить тип задачи {a.get("taskId")}', _preview_default),
    'cancelTask':       ToolMeta('cancelTask', SCOPE_KANBAN_WRITE, True,
                                  lambda a: f'Отменить задачу {a.get("taskId")}', _preview_default),
    'addTaskComment':   ToolMeta('addTaskComment', SCOPE_KANBAN_WRITE, True,
                                  lambda a: f'Добавить комментарий к задаче {a.get("taskId")}', _preview_default),
    'createSprint':     ToolMeta('createSprint', SCOPE_KANBAN_WRITE, True,
                                  lambda a: f'Создать спринт «{_truncate(a.get("name"))}»', _preview_default),
    'startSprint':      ToolMeta('startSprint', SCOPE_KANBAN_WRITE, True,
                                  lambda a: f'Запустить спринт {a.get("sprintId")}', _preview_default),
    'closeSprint':      ToolMeta('closeSprint', SCOPE_KANBAN_WRITE, True,
                                  lambda a: f'Завершить спринт {a.get("sprintId")}', _preview_default),
    # agents-internal tools
    'save_memory': ToolMeta('save_memory', SCOPE_MEMORY_WRITE, False,
                             _summary_generic('save_memory'), _preview_default),
    'recall_memory': ToolMeta('recall_memory', SCOPE_MEMORY_READ, False,
                               _summary_generic('recall_memory'), _preview_default),
}


def build_registry_for_servers(
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
                namespaced = f'{server_name}__{tool_name}'
                # Do not overwrite a more specific entry already set from
                # DEFAULT_ENGINES_TOOLS (which carries the real scope and
                # confirmation policy for engines-built-in tools).
                if namespaced in registry:
                    continue
                registry[namespaced] = ToolMeta(
                    name=tool_name,
                    required_scope=None,
                    requires_confirmation=True,
                    summarize=_summary_generic(f'{server_name}.{tool_name}'),
                    preview=_preview_default,
                )
    return registry
