# Page-chat UX + page tooling — Design

**Status:** approved (autonomous session 2026-07-10; requirements = владельский список из 12 пунктов, зафиксирован дословно в §1)
**Builds on:** `2026-07-08-space-ai-page-chats-design.md` (merged, v1.36.0). This spec closes its §10 follow-ups around the page-chat panel and un-defers Notion's "Floating" display mode.
**Branch:** `feat/page-chat-ux-tooling` off `main`.

## 1. Requirements (owner's list, verbatim mapping)

1. FAB прячется, пока панель чата открыта; появляется при закрытии.
2. Кнопка закрытия панели — `»` (double-chevron right), title «Скрыть чат» — зеркало кнопки «Скрыть» левого сайдбара (`KeyboardDoubleArrowLeftIcon`).
3. Панель появляется/уходит с анимацией (без дёрганья).
4. Плейсхолдер пустой строки редактора: «Нажмите «пробел» для AI или «/» — для команд».
5. Два режима панели: docked справа (как сейчас) и **плавающее окно** (Notion "Floating"); переключатель — иконка-меню в шапке между «Новый чат» и «Скрыть чат».
6. Вывод ассистента без левого «рельсового» отступа — на всю ширину панели.
7. Живые кейсы (см. §9).
8. Вся история чата попадает в промпт при отправке с page-context.
9. Заголовок панели «Чат по странице» → «Чат».
10. Загрузка файла в page-чате не должна падать.
11. Загрузка файлов — как в большом агенте (кейс: файл → «вставь этот текст в конец страницы»).
12. Тулинг: добавление текста в конец страницы, переименование страницы, замена текста на странице, вставка файла в страницу.

## 2. UI: панель page-чата (пп. 1–3, 5, 9)

`apps/web/src/components/page/page-chat/`:

- **`PageChatContext`** gains `displayMode: 'docked' | 'floating'` + `setDisplayMode`, persisted to `localStorage['pageChat.displayMode']` (the `workspace.sidebar.mode` pattern: default `docked`, hydrate in `useEffect`).
- **FAB**: wrapped in `<Zoom in={!panelOpen} unmountOnExit>` — скрыт, пока панель открыта (п.1). `rightOffset` больше не учитывает панель чата (FAB и открытая панель невидимы одновременно), учёт комментариев остаётся.
- **Docked mode**: контейнер панели — `<Collapse orientation="horizontal" in={open} unmountOnExit>` вокруг колонки фиксированной ширины 400 → плавный выезд/уход (п.3). Сама колонка — как сейчас (borderLeft, flexShrink 0).
- **Floating mode**: `<Grow in={open} unmountOnExit>` вокруг `Paper` `position: fixed; bottom: 24; right: 24; width: 420; height: min(640px, 100vh - 96px); zIndex: modal - 1; borderRadius: 3; elevation 8; display:flex; column`. Не участвует в flex-строке лэйаута — офсеты Outline/комментариев не трогает.
- **Header**: `Typography` «Чат» (п.9); справа от «Новый чат»/меню треда — новая иконка режима (`ViewSidebarRoundedIcon`, tooltip «Режим отображения») с `Menu` из двух пунктов: «Сбоку справа» / «Плавающее окно» (галочка на активном); затем кнопка скрытия `KeyboardDoubleArrowRightIcon`, `aria-label`/tooltip «Скрыть чат» (п.2).
- **`@repo/ui` re-exports** (repo rule): `KeyboardDoubleArrowRightIcon`, `ViewSidebarRoundedIcon`, `PictureInPictureAltIcon`, `Collapse`, `Grow`, `Zoom`, `Paper` — добавить недостающие в `packages/ui/src/components/index.ts`.

Отклонённая альтернатива: держать панель всегда смонтированной с `width: 0↔400` вручную — `Collapse horizontal` делает то же самое штатно (и не оставляет живых tRPC-подписок у закрытой панели благодаря `unmountOnExit`).

## 3. Плейсхолдер (п. 4)

`packages/editor/src/anynote-editor.tsx:147`: `'Нажмите «пробел» для AI, «/» — для команд'` → `'Нажмите «пробел» для AI или «/» — для команд'`. Регэксп в `apps/e2e/space-ai.spec.ts:285` (`/Нажмите «пробел» для AI/`) остаётся валидным; комментарий в шапке спеки обновить.

## 4. Плотный рендер вывода (п. 6)

Сейчас каждый part ассистента рендерится в `@mui/lab` Timeline: слева рельса-сепаратор (~20-24px) + residual `padding-left: 16px` у `TimelineContent` → ~36-40px мёртвого отступа на каждой строке; в панели 400px это ~10% ширины.

Новый проп `density?: 'comfortable' | 'compact'` (default `comfortable`) на **ChatThread → ChatMessageList → ChatMessageContent** (`packages/ui/src/components/chat/`). В `compact`:

- text/thinking-parts — обычный `Stack` без Timeline, на всю ширину;
- tool-parts — `ChatServiceBlock` с маленькой (8px) inline-точкой статуса слева (цвет из `toolDotColor` — сигнал состояния сохраняется);
- attachment-parts — как есть (chip).

`WorkspaceChatClient` передаёт `density="compact"` в page-варианте. Большой чат не меняется (там рельса — осознанный дизайн таймлайна).

## 5. История в промпте (п. 8)

`buildChatHistoryMessages` (`apps/web/src/lib/chat/chat-history.ts`) сейчас: текущий чат капится последними 10 сообщениями (+первое), а ходы ассистента без текстовых сегментов (tool-only) выпадают целиком.

Изменения:

- Для `kind === 'PAGE'` чатов — **вся** история текущего чата (page-чаты короткоживущие и привязаны к странице; смысл «вся история» — владельческое требование). NORMAL-чаты не трогаем.
- Tool-only ходы ассистента больше не выпадают: если текстовых сегментов нет, ход входит в историю строкой вида `[Выполнены инструменты: appendToPage, get_file_content]` — тред остаётся связным («добавь ЭТО в конец страницы» после tool-хода).
- Страховочный кап у агентов (`trim_chat_history`, 30 сообщений head5+tail15) остаётся как защита контекстного окна — документируется как известное ограничение.

## 6. Загрузка файлов в page-чате (пп. 10–11)

`/api/files/upload` привязывает файл к workspace из `resolveActiveWorkspace(userId)` (stored preference), а весь page-чат живёт от workspace **страницы**. При расхождении (несколько воркспейсов, смена в другой вкладке, гость) — файл падает в чужой workspace, и generate отвечает 400 «One or more files are invalid for this chat»; для гостя ломается и `file.listRecent`.

Фикс: аплоад становится **детерминированным по workspace**:

- `/api/files/upload` принимает опциональный `workspaceId` (query). Для workspace-scoped kind'ов при его наличии: проверка активного членства (member, not blocked) → 403 иначе; квота/дедуп/S3 — против него. Без параметра — прежнее поведение (обратная совместимость: аватарки, старые вызовы).
- `useDraftAttachments` получает `workspaceId` и шлёт его в query; `WorkspaceChatClient` прокидывает свой `workspaceId` (оба варианта — big chat и page chat).

Точная причина владельческой ошибки подтверждается живой репродукцией до фикса (Playwright), результат фиксируется в отчёте.

## 7. Тулинг страниц + живое редактирование (п. 12)

### 7.1 Что уже есть (engines MCP, `apps/engines/src/apps/mcp/tools/`)

`appendToPage` (append markdown), `updatePage` (полная перезапись title/icon/content/markdown), `attachFileToPage`/`uploadFileToPage` (вставка файла), `get_file_content` — т.е. 3 из 4 запрошенных тулов существуют. Добавляются:

- **`renamePage`** — тонкий тул `{workspaceId, pageId, title}` поверх `PageWriter.updatePage` (title-only; Prisma игнорирует undefined-поля — контент не трогается). Требует подтверждения, scope `pages:write`.
- **`replaceInPage`** — `{workspaceId, pageId, find, replace, all?}`: таргетная замена текста в TEXT-странице. Реализация по текстовым узлам живого дока (см. 7.3), совпадение в пределах одного текстового узла; ненайденное → понятная ошибка тулу. Scope `pages:write`, подтверждение.

Регистрация: `DEFAULT_ENGINES_TOOLS` в `apps/agents/.../tool_registry.py` (+ guard-тест `agents-token.test.ts` — двусторонний контракт скоупов; `pages:write` уже входит в `WRITE_SCOPES`).

### 7.2 Page-binding в промпте

Агент в page-чате не знает pageId текущей страницы — кейсы «добавь в конец страницы» разваливаются на угадывании. Для `kind === 'PAGE'` generate-route дополняет `agent_system_prompt` блоком: чат привязан к странице «title» (`pageId`, `workspaceId`); просьбы изменить «страницу/текущую страницу» выполняются инструментами `appendToPage` / `updatePage` / `replaceInPage` / `renamePage` / `attachFileToPage` с этими идентификаторами.

### 7.3 Живое редактирование — `YjsPageEditor` (ключевое архитектурное решение)

Сейчас `PageWriter` пишет `content`+`contentYjs` напрямую в БД. Пока страница открыта, Hocuspocus держит авторитетный док в памяти: пользователь не увидит правку агента, а ближайший `onStoreDocument` её **перезапишет** (lost update). Для page-чата «страница открыта» — основной сценарий.

Решение: engines применяет контентные правки **через yjs-сервер**, как обычный клиент:

- Новый сервис `YjsPageEditor` (engines): `@hocuspocus/provider` + `ws`-полифилл; подключение к `NEXT_PUBLIC_YJS_URL` с самоподписанным share-токеном (`jose`, HS256, `YJS_SHARE_TOKEN_SECRET` — оба env уже существуют; claims: `typ:'share'`, `pageId`, `shareId:'agent-tools'`, `role:'EDITOR'`, `sub: actorUserId`, `name:'AI-агент'`, exp 2m). apps/yjs проверяет только подпись+pageId — токен и есть авторитет; секрет общий внутри бекенд-контура (документируемое допущение).
- Операции над живым `Y.XmlFragment('default')` в одной транзакции: `appendNodes` (клонирование узлов из `TiptapTransformer.toYdoc`-дока в целевой — рекурсивный клон XmlElement/XmlText), `replaceAll` (delete children + клон новых), `replaceText` (поиск/замена в Y.XmlText узлах). После flush — disconnect; персист/ревизии/outbox едут штатным `onStoreDocument`.
- **Fallback**: если ws-подключение не удалось за таймаут (yjs-сервер выключен ⇒ живых доков нет) — прежний прямой DB-путь (`buildContentYjs`), он в этом случае корректен.
- `appendToPage`, `updatePage` (контентная часть), `replaceInPage`, `attachFileToPage` (контентная вставка узла файла) — все идут через `YjsPageEditor`. `renamePage`/title — прямой DB-путь (title не в Yjs-доке).

Отклонённые альтернативы: (а) прямой DB-write + перезагрузка дока сервером — Hocuspocus не умеет reload живого дока, а merge независимо построенных CRDT-доков дублирует контент; (б) правка через локальный редактор клиента — тулы исполняются на сервере, клиент может быть закрыт.

## 8. Безопасность / инварианты

1. Share-токен engines — `role: 'EDITOR'` на конкретный `pageId`, TTL 2 минуты, минтится только внутри тула, уже прошедшего JWT-scope-гейт (`pages:write`) + workspace-проверку `PageWriter`. Прав не расширяет: тот же пользовательский актор.
2. Upload с явным `workspaceId` требует активного членства — не слабее прежнего active-workspace пути.
3. Полная история — только для PAGE-чатов; агентский `trim_chat_history` остаётся страховкой контекста.
4. Плейсхолдер/FAB/панель: план-гейтинг не меняется (visible-but-paywalled, спека 2026-07-08 §8.2).
5. Page-binding блок — серверная вставка в системный промпт (id из БД, не от клиента).

## 9. Живые кейсы (владельские, п. 7 + 11) — критерий приёмки

На реальном dev-стенде (страница открыта в браузере, page-чат открыт):

1. «суммаризируй информацию по странице» → ответ-суммаризация; «добавь суммаризацию в конец страницы» → `appendToPage`, текст появляется в открытом редакторе без перезагрузки.
2. «напиши текст про русскую баню» → текст; «добавь этот текст на текущую страницу» → append, виден живьём.
3. «напиши текст про русскую баню» → текст; «замени этот текст на странице» → замена контента страницы, видна живьём.
4. Загрузка файла в page-чат (без ошибки) → «вставь этот текст в конец страницы» → контент файла добавлен в страницу.

## 10. Тесты

- **web unit**: chat-history (PAGE = вся история; tool-only ход → сводка-строка), upload route (workspaceId: членство/403/квота), generate route (page-binding блок только для PAGE).
- **@repo/ui**: ChatMessageContent density=compact (нет Timeline, tool-точка присутствует), существующие тесты не ломаются.
- **engines**: YjsPageEditor — клон узлов (append/replace/replaceText на Y-доках, без ws), renamePage/replaceInPage тулы (jest unit с моком PageWriter/YjsPageEditor); share-токен формат.
- **agents**: tool_registry — новые тулы в DEFAULT_ENGINES_TOOLS (существующий контракт-тест).
- **e2e**: `page-chat.spec.ts` — обновить заголовок/aria («Чат», «Скрыть чат»), FAB скрыт при открытой панели, переключение в плавающий режим.
- **Живые кейсы §9** — вручную через Playwright MCP, с фиксацией результатов.

**Merge gate**: `pnpm gates` вручную + затронутые Playwright-спеки.

## 11. Честные ограничения

- `replaceInPage` находит совпадение только внутри одного текстового узла (разметка внутри искомой фразы дробит узлы) — ошибка тула с подсказкой использовать `updatePage`.
- `trim_chat_history` (30 сообщений) у агентов остаётся — «вся история» упирается в этот страховочный кап.
- Плавающий режим — одна фиксированная геометрия (без drag/resize, Notion-параметр «Expand» не переносим).
- Заголовок страницы при `renamePage` обновится в UI при следующей инвалидации/навигации (push-канала для title нет).
- Live-редактирование требует доступного yjs-сервера; при его недоступности правки применяются в БД (и корректны, т.к. живых доков нет).
