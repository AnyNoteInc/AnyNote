# Page-chat UX + page tooling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть 12 владельских пунктов по page-чату: анимация/режимы панели, компактный вывод, полная история, надёжный аплоад, page-тулинг с живым Yjs-редактированием.

**Architecture:** Веб-часть — точечные правки page-chat компонентов + новый `density`-проп в `@repo/ui` чате; серверная часть — полная история для PAGE-чатов + workspaceId-детерминированный аплоад + page-binding системный промпт; engines — `YjsPageEditor` (Hocuspocus-клиент с самоподписанным share-токеном) как канал контентных правок + тулы `renamePage`/`replaceInPage`.

**Tech Stack:** Next.js 16/React 19/MUI v6, NestJS 11, @hocuspocus/provider v4 + yjs, jose, LangGraph tool registry (Python), Playwright.

**Spec:** `docs/superpowers/specs/2026-07-10-page-chat-ux-tooling-design.md`

---

### Task 1: Placeholder (п.4)

**Files:** Modify `packages/editor/src/anynote-editor.tsx:147`, `apps/e2e/space-ai.spec.ts:30` (комментарий).

- [ ] Заменить строку на `'Нажмите «пробел» для AI или «/» — для команд'`; обновить комментарий в e2e-спеке; `pnpm --filter @repo/editor test` (плейсхолдер-тесты, если ассертят текст — обновить).
- [ ] Commit `fix(editor): empty-line placeholder wording`.

### Task 2: UI-kit re-exports

**Files:** Modify `packages/ui/src/components/index.ts`.

- [ ] Добавить отсутствующие re-exports: `KeyboardDoubleArrowRightIcon`, `ViewSidebarRoundedIcon`, `PictureInPictureAltIcon`, `Collapse`, `Grow`, `Zoom` (проверить `Paper`, `CheckIcon` — добавить при отсутствии).
- [ ] Commit `feat(ui): re-export icons/transitions for page-chat panel`.

### Task 3: ChatThread density prop (п.6)

**Files:** Modify `packages/ui/src/components/chat/chat-thread.tsx`, `chat-message-list.tsx`, `chat-message-content.tsx`; Test `packages/ui/test/` (рядом с существующими чат-тестами).

- [ ] `ChatMessageContent`: новый проп `density?: 'comfortable' | 'compact'`. При `compact` и `variant='assistant'` — вместо `<Timeline>` рендер `<Stack spacing={1}>`; text/thinking parts как есть (полная ширина); tool-parts в `<Stack direction="row" spacing={1} alignItems="flex-start">` с точкой 8×8 (`borderRadius: '50%'`, `mt: '7px'`, цвет из `toolDotColor(part.state)` → palette) перед `ChatServiceBlock`.
- [ ] Пробросить `density` через `ChatMessageList` (в `<ChatMessageContent>`) и `ChatThread` (props → list). Тест: compact не содержит `.MuiTimeline-root`, содержит текст и tool-точку; comfortable — прежний Timeline.
- [ ] `apps/web/src/components/workspace/chat/workspace-chat-client.tsx`: `density={pageProps ? 'compact' : 'comfortable'}` (проп ChatThread).
- [ ] `pnpm --filter @repo/ui test`; Commit `feat(ui): compact chat density for narrow page panel`.

### Task 4: Панель — FAB, шапка, анимация, режимы (пп.1,2,3,5,9)

**Files:** Modify `apps/web/src/components/page/page-chat/page-chat-context.tsx`, `page-chat-fab.tsx`, `page-chat-sidebar.tsx`; `apps/e2e/page-chat.spec.ts` (обновить селекторы/ассерты).

- [ ] Context: `displayMode: 'docked'|'floating'` + `setDisplayMode`; localStorage `pageChat.displayMode` (hydrate в useEffect, SSR-safe), сброс не требуется при навигации.
- [ ] FAB: обернуть в `<Zoom in={!chat.panelOpen} unmountOnExit>`; убрать слагаемое панели из `rightOffset`.
- [ ] Sidebar: заголовок «Чат»; кнопка скрытия — `KeyboardDoubleArrowRightIcon` + Tooltip/aria «Скрыть чат»; иконка режима (`ViewSidebarRoundedIcon`, aria «Режим отображения», data-testid `page-chat-mode`) между «Новый чат»(+меню треда) и «Скрыть чат», `Menu` с пунктами «Сбоку справа»/«Плавающее окно» (иконки ViewSidebar/PictureInPicture, галочка активного).
- [ ] Обёртки: docked → `<Collapse orientation="horizontal" in={open} unmountOnExit>` вокруг текущей колонки (width 400 внутри); floating → `<Grow in={open} unmountOnExit>` + `Paper` fixed bottom/right 24, width 420, height `min(640px, calc(100vh - 96px))`, zIndex `(t) => t.zIndex.modal - 1`, elevation 8, borderRadius 3. Внутренности панели общие (выделить в локальный компонент/фрагмент).
- [ ] Открытая панель должна рендериться даже при `panelOpen=false` на время exit-анимации — `Collapse/Grow unmountOnExit` это делают сами; `if (!ctx?.enabled) return null` остаётся, убрать ранний `!ctx.panelOpen` return.
- [ ] e2e `page-chat.spec.ts`: «Чат по странице» → «Чат», aria «Закрыть чат» → «Скрыть чат», + ассерты: FAB невидим при открытой панели, переключение в плавающий режим показывает панель в `Paper` (testid `page-chat-floating`).
- [ ] Commit `feat(web): page-chat panel — hide FAB, slide animation, docked/floating modes`.

### Task 5: История PAGE-чатов (п.8)

**Files:** Modify `apps/web/src/lib/chat/chat-history.ts`, `apps/web/src/app/api/agents/generate/route.ts:192`; Test `apps/web/test/chat-history*.test.ts` (существующий рядом — найти и расширить).

- [ ] `buildChatHistoryMessages` получает opts `{ fullCurrentChat?: boolean }`; при true текущий чат читается целиком (`findMany asc`, без окна). Route: `fullCurrentChat: chat.kind === 'PAGE'`.
- [ ] Tool-only ходы: в `extractText`-обходе, если текстовых part нет, но есть tool-parts (`type === 'tool'` c `title`/`detail.tool`) — вернуть `[Выполнены инструменты: X, Y]` (имена из detail.tool или title). Пустые по-прежнему пропускаются.
- [ ] Тесты: PAGE-чат с 15 сообщениями → все 15; NORMAL → прежнее окно 10+first; tool-only ход даёт сводку-строку.
- [ ] `pnpm --filter web test`; Commit `fix(web): full history for page chats, keep tool-only turns in prompt`.

### Task 6: Upload workspaceId (пп.10,11)

**Files:** Modify `apps/web/src/app/api/files/upload/route.ts`, `apps/web/src/components/workspace/chat/use-draft-attachments.ts`, `workspace-chat-client.tsx`; Test существующий upload-route тест в `apps/web/test/`.

- [ ] Route: `workspaceId` из query (UUID-валидация). Для workspace-scoped kind: если задан — проверить членство (`workspaceMember` some userId + not blocked) → 403 «Нет доступа к пространству», использовать вместо active-workspace; иначе прежний путь.
- [ ] `useDraftAttachments({ workspaceId })`: query `?kind=attachment&workspaceId=...`; клиент прокидывает.
- [ ] Тесты: с workspaceId члена — файл в нём; с чужим — 403; без — прежнее поведение.
- [ ] Живая репродукция ДО фикса в page-чате (Playwright MCP) — зафиксировать фактическую ошибку владельца; ПОСЛЕ — аплоад зелёный.
- [ ] Commit `fix(web): deterministic upload workspace for chat attachments`.

### Task 7: engines YjsPageEditor (п.12, ядро)

**Files:** Create `apps/engines/src/apps/mcp/services/yjs-page-editor.service.ts`, `apps/engines/src/apps/mcp/services/yjs-clone.ts`; Modify `page-writer.service.ts`, `apps/engines/package.json` (+`@hocuspocus/provider@^4.3.0`, `ws`, `jose`), mcp module providers; Test `apps/engines/test/yjs-clone.spec.ts` (unit, без ws).

- [ ] `yjs-clone.ts`: `cloneXmlInto(source: Y.XmlFragment, target: Y.XmlFragment, at?: number)` — рекурсивный клон `Y.XmlElement` (nodeName+attributes+children) / `Y.XmlText` (insert с format-атрибутами через `toDelta()`); unit-тесты append/replace на двух Y.Doc.
- [ ] `YjsPageEditor`: `applyContentEdit({ pageId, actorUserId, edit })`, где edit = `{ kind: 'append', doc: TiptapJson } | { kind: 'replaceAll', doc: TiptapJson } | { kind: 'replaceText', find, replace, all }`. Внутри: mint share-token (jose HS256, secret `YJS_SHARE_TOKEN_SECRET`, claims typ:'share', pageId, shareId:'agent-tools', role:'EDITOR', sub:actorUserId, name:'AI-агент', exp 2m); `HocuspocusProvider` c `WebSocketPolyfill: ws`, url из `NEXT_PUBLIC_YJS_URL`; ожидание synced (таймаут ~4s); транзакция над `doc.getXmlFragment('default')` (append → clone в конец; replaceAll → delete(0,len)+clone; replaceText → обход `Y.XmlText` узлов, замена в пределах узла, счётчик замен); flush+destroy. Возврат `{ applied: true, via: 'yjs' }` | `{ applied: false }` при недоступности ws.
- [ ] `PageWriter.appendContent`/`updatePage`(контент): сперва `YjsPageEditor.applyContentEdit`; при `applied` — пропустить прямую запись content/contentYjs (persist придёт из onStoreDocument), но outbox-событие оставить; при `!applied` — прежний DB-путь. `replaceText` при `!applied` — прочитать content из БД, применить замену по текстовым узлам Tiptap JSON, записать c `buildContentYjs`.
- [ ] `pnpm --filter engines test`; Commit `feat(engines): apply agent page edits through live yjs doc`.

### Task 8: Тулы renamePage / replaceInPage + registry + промпт (п.12)

**Files:** Modify `apps/engines/src/apps/mcp/tools/page.tools.ts`, `apps/agents/agents/apps/agent/services/tool_registry.py`, `apps/web/src/app/api/agents/generate/route.ts` (+`agents-payload.ts` при необходимости); Test engines jest + agents pytest контракт + `apps/web/test/agents-token.test.ts` guard.

- [ ] `renamePage` `{workspaceId, pageId, title(1..255)}` → `PageWriter.updatePage` title-only; описание на русском по образцу соседей; confirmation.
- [ ] `replaceInPage` `{workspaceId, pageId, find(1..2000), replace(0..10000), all?}` → `YjsPageEditor replaceText` (+DB fallback); ответ `{ replacements }`; 0 замен → текст-подсказка «не найдено, используй updatePage».
- [ ] `tool_registry.py`: `anynote__renamePage`, `anynote__replaceInPage` → `pages:write`, confirm. Обновить контракт-тесты реестра (pytest) при наличии snapshot-списка.
- [ ] Route: для PAGE-чата дополнить `agent_system_prompt` page-binding блоком (title+pageId+workspaceId, список тулов) — в `settingsSnapshot.systemPrompt` перед `buildAgentRunPayload`.
- [ ] Гейты пакетов; Commit `feat(engines,agents,web): page rename/replace tools + page-bound system prompt`.

### Task 9: Живые кейсы (пп.7, 11) — приёмка

- [ ] Через Playwright MCP на dev-стенде: кейсы §9 спеки (суммаризация→append; баня→append; баня→replace; файл→append). Страница открыта в браузере — правки видны без перезагрузки. Зафиксировать результат каждого кейса.

### Task 10: Финал

- [ ] `pnpm gates` (вручную — хук не активен), `pnpm exec playwright test apps/e2e/page-chat.spec.ts apps/e2e/space-ai.spec.ts`.
- [ ] Код-ревью (superpowers:requesting-code-review) + фиксы.
- [ ] Итоговый отчёт владельцу (что сделано, живые кейсы, ограничения §11 спеки).

## Self-review

- Покрытие спеки: §2→Task 4(+2), §3→Task 1, §4→Task 3, §5→Task 5, §6→Task 6, §7→Tasks 7-8, §9→Task 9, §10→Tasks 1-8 тесты + Task 10. Пробелов нет.
- Типы согласованы: `density` единое имя через 3 слоя; `applyContentEdit` единая сигнатура Task 7/8.
- Плейсхолдеров нет; код тонких мест приведён на уровне сигнатур — исполнитель этой сессии держит полный контекст файлов.
