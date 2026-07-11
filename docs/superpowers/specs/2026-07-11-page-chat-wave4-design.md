# Page-chat wave 4 — block Ask-AI, PDF tool, image↔file insert, prompt-echo, resize perf

Дата: 2026-07-11. Ветка: `feat/page-chat-ux-tooling`. Пять независимых правок,
запрошенных одним сообщением; каждая опирается на существующие механизмы —
новых сервисов и env-переменных не появляется.

## 1. «Спросить AI» в меню drag-handle (правка одного блока)

**Что.** В меню шести точек (`packages/editor/src/components/drag-handle-menu.tsx`)
после разделителя и перед «Копировать текст» появляется пункт «Спросить AI»
(AutoAwesomeIcon). Клик открывает существующий `InlineAiPopover` над блоком;
диапазон — ВНУТРЕННЕЕ содержимое блока (`from = pos + 1`,
`to = pos + node.nodeSize − 1` — прецедент `handleTextColor`), так что
преобразование сохраняет контейнер (заголовок остаётся заголовком).

**Как.** Никаких новых пропсов из apps/web: возможность уже доступна через
`editor.storage.ai` (`askAI` гейтит видимость, `onAskAi` открывает поповер —
путь плавающего тулбара). Хелпер `blockAskAiCapture(editor, pos)` (новый чистый
экспорт в `packages/editor/src/lib/`) возвращает
`InlineAiCapturedRange | null`: внутренний диапазон, `selectedText =
doc.textBetween(from, to, ' ')`, якорь — DOM-нода блока
(`view.nodeDOM(pos)`), с фолбэком на виртуальный якорь от `coordsAtPos`
(без `nodeType` — контракт Popper). Пункт скрыт для блоков без текста
(`node.textContent.trim() === ''` — картинки, разделители, atom-ноды) и когда
`storage.ai.askAI/onAskAi` отсутствуют (plain-редакторы).

Меню получает `disableRestoreFocus`, чтобы возврат фокуса MUI Menu не отбирал
фокус у автофокусного поля поповера. Дальше работает готовый конвейер:
`onAskAi` → `captureInlineAiRange` (Yjs-якоря, подсветка) → поповер →
стриминговое превью → «Принять».

## 2. MCP-инструмент «сформируй из страницы PDF»

**Что.** Новый инструмент `exportPageToPdf({workspaceId, pageId})` в
apps/engines: рендерит TEXT-страницу в PDF через Gotenberg, кладёт файл в S3,
создаёт `File` (workspaceId задан, без `expiresAt`) + связь `PageFile`
(= «файл прикреплён к странице»), возвращает `{fileId, url:
'/api/files/<id>', name, size}`. Модель отвечает markdown-ссылкой — чат уже
рендерит относительные ссылки кликабельными.

**Архитектура.** Рендер-цепочка (tiptap JSON → HTML → embed-images → обёртка →
Gotenberg) извлекается из `apps/web/src/server/page-export/` в новый
NodeNext-чистый пакет **`@repo/page-export`** (прецедент `@repo/domain`:
явные `.ts`-расширения, без enum/параметр-свойств — engines исполняет TS через
strip-types). Переезжают: `server-extensions`, `tiptap-to-html`,
`embed-images`, `render-page`, `wrap-html-document`, `print-stylesheet`,
`html-to-pdf`, `errors`. apps/web переключает импорты на пакет (маршрут
экспорта + PDF_ZIP-джоба), дублирования не остаётся. `GOTENBERG_URL` уже
прописан для engines в dev и prod — env-плоскость не трогаем.

**Гейты инструмента** (порядок как в `page-file.tools.ts`): `requireAuth` →
`assertMember` → `assertPageBindingAllows(auth, pageId)` → страница через
`pageVisibilityWhere`, только `type: TEXT` → политика 8C
`assertExportAllowed` (иначе инструмент — обход запрета экспорта). Контент —
живой док через `YjsPageEditor.readLiveContent`, фолбэк `Page.content`.
Персист — новый метод `FileUploader` без 1MB-капа `uploadInline`.

**Двусторонний контракт.** `tool_registry.py`: `ToolMeta('exportPageToPdf',
SCOPE_FILES_WRITE, page_arg='pageId')` — скоуп уже выдаётся
OWNER/ADMIN/EDITOR, guard-тест не меняется; PAGE-чат сможет экспортировать
только свою страницу. Плюс правка `renderChatLink`: `/api/...`-ссылки
рендерятся простым `<a>` (не `next/link`) — иначе prefetch/RSC-навигация
дёргает скачивание.

## 3. Вставка файла/изображения как файла или изображения

**Что.** Все четыре комбинации достижимы без модальных диалогов:

- вставка (paste) изображения → как сейчас, нода `image`; у ноды появляется
  действие «Сохранить как файл» — своп в `fileAttachment`;
- `/файл` с изображением → как сейчас, `fileAttachment`; у вложения с
  `mimeType image/*` появляется действие «Показать как изображение» — своп в
  `image` (прецедент «Воспроизвести как видео»);
- drop файла-изображения в редактор → теперь вставляет `image`
  (закрывается существующая дыра: image-drop не обрабатывал никто);
- смешанный paste (изображения + другие файлы) → изображения идут в `image`,
  остальные в `fileAttachment` (сейчас не-изображения молча теряются).

**Как.** Общие процедуры вставки плейсхолдеров выносятся в
`packages/editor/src/extensions/upload-insert.ts` (используют существующий
паттерн `uploadId`-плейсхолдеров); `image-paste.ts` и `file-upload.ts`
переиспользуют их (без циклических импортов). Ноде `image` добавляются
атрибуты `name/size/mimeType` (data-атрибуты; проставляются при загрузке),
чтобы своп image→file не терял метаданные. Чистые конвертеры
`imageToAttachmentNode` / `attachmentToImageNode` живут в `media-mime.ts`
рядом с video/audio-конвертерами. Попутно: guard `view.isDestroyed` в
async-колбэках `file-upload.ts` (паритет с image-paste).

## 4. Эхо промпта «Выведи только результат без пояснений…»

**Диагноз.** Клиентский мост фильтрует SSE верно; plan_step-эхо подавлено
ранее. Утечка — на уровне LLM: мета-инструкция и исходный текст входят в
user message, а executor.j2 дополнительно цитирует заголовок тривиального
плана (= весь промпт) внутри system prompt. Модель повторяет инструкцию в
ответе.

**Фикс, две стороны.**
1. apps/web (`inline-prompts.ts` + `handler.ts`): мета-инструкции («Выведи
   только результат…», «Сгенерируй ТОЛЬКО итоговый markdown…») переезжают из
   user message в system prompt (`agent_system_prompt` = workspace-промпт +
   инлайн-приставка; поле уже рендерится в executor.j2). User message =
   инструкция + текст.
2. apps/agents (`executor.j2` / executor-рендер): для тривиального маршрута
   (план из одного шага, чей title == user_message — общий предикат с
   `_is_question_echo_plan`) шаг не цитируется в system prompt; вместо него —
   нейтральное «ответь на запрос пользователя, выведи только результат».
   Чинит эхо и в обычных чатах.

Тесты `ai-inline-prompts.test.ts`, проверяющие старую строку в user message,
обновляются (правило: развернул поведение — обнови закреплявшие его тесты).

## 5. Тормоза при перетягивании ширины сайдбаров

**Диагноз.** Каждый pointermove делает `setState` на вершине дерева:
левый сайдбар — state в `WorkspaceLayoutClient` (ререндер всего воркспейса,
включая Tiptap через немемоизированный value `PageEditorProvider`); правый
чат — `sidebarWidth` в deps value-useMemo `PageChatProvider` (ререндер всех
консьюмеров, включая `PageRenderer`). Плюс ширина через `sx` = новый
emotion-класс на каждый пиксель. rAF-троттлинга нет.

**Фикс — живое значение мимо React, коммит один раз.**
- `panel-resize-handle.tsx`: rAF-троттлинг `onWidth` (≤1 вызов/кадр), новый
  проп `onDragStart`, отмена rAF на up/cancel/unmount, флаш последнего
  значения ПЕРЕД `onCommit`.
- `workspace-shell.tsx`: колонка через CSS-переменную
  (`gridTemplateColumns: 'var(--ws-sidebar-w) minmax(0,1fr)'`, значение —
  inline style от закоммиченного state); во время drag `onWidth` пишет
  переменную императивно через ref; `transition: none` на весь drag
  (через `onDragStart`). Проп `onSidebarWidthChange` удаляется.
- `workspace-layout-client.tsx`: живой `setSidebarWidth` отвязан; остаётся
  только `commitSidebarWidth` (state + localStorage) на отпускании.
- `editor-context.tsx`: value провайдера мемоизируется (useCallback/useMemo) —
  самый дешёвый и самый действенный фикс: любой ререндер layout-клиента
  перестаёт тащить за собой Tiptap.
- `page-chat-sidebar.tsx`: ширина панели inline-style + ref; во время drag —
  императивная запись `style.width`; `setSidebarWidth` удаляется из
  контекста (единственный потребитель — ручка). `contain: 'layout style'`
  на обеих панелях.
- Компромисс: `EditorOutline` следует за шириной чата только на коммите
  (снап в конце drag), `aria-valuenow` обновляется на коммите.

## Тестирование

- editor: юнит-тесты `blockAskAiCapture` (диапазон/гейты), конвертеров
  image↔file, обновление `file-upload.routing.test.tsx` (drop изображения),
  зелёный `paste-precedence.test.tsx`.
- web: обновлённые `ai-inline-prompts.test.ts`; тест handler'а на
  system-prompt-приставку.
- engines: jest-тест инструмента `exportPageToPdf` (гейты: membership,
  page-binding, тип страницы, политика экспорта).
- agents: pytest на нейтрализацию эхо-шага в executor-промпте; обновление
  exempt-list в `test_tool_registry.py` при необходимости.
- Полный `pnpm gates` + adversarial-review workflow перед коммитом.
