# Просмотрщик файлов и схем — сплит-панель + полноэкранный режим

Дата: 2026-07-11. Ветка: `feat/file-preview-viewer`.

Клик по загруженному файлу или схеме на TEXT-странице открывает просмотр
содержимого. Два режима: **сплит** — правая докованная панель (~50% экрана,
документ остаётся слева) и **фуллскрин** — `Dialog fullScreen`; переключение
иконками `OpenInFullIcon` (сплит → фуллскрин) и `CloseFullscreenIcon`
(фуллскрин → сплит). Без новых библиотек и env-переменных: PDF показывает
встроенный просмотрщик браузера, office-форматы конвертирует уже развёрнутый
Gotenberg.

## 1. Контракт «редактор → приложение»

**Что.** Редактор не знает о панели: NodeView'ы вызывают новый опциональный
проп `onOpenFilePreview(payload)`, приложение решает, как показывать.

**Как.** В `packages/editor/src/types.ts` добавляются экспортируемые типы:

```ts
type FilePreviewPayload =
  | { kind: 'file'; url: string; name: string | null; mimeType: string | null; size: number | null }
  | { kind: 'diagram'; svg: string; title?: string } // raw SVG-разметка ИЛИ data:image/svg+xml-URI
```

и `onOpenFilePreview?: (payload: FilePreviewPayload) => void` в пропсах
редактора. Коллбек протягивается через `extensions/index.ts` в опции
`ResizableImage`, `FileAttachment`, `Video`, `Audio`, `Drawio`, `CodeBlock`
(прецеденты: `drawioUrl`, `plantumlRenderAuth`); NodeView читает его из
`props.extension.options`. Когда проп не передан (template-редактор
`page-view.tsx`, публичные страницы) — поведение каждого узла остаётся
текущим, ничего не ломается.

## 2. Триггеры по узлам

- **image** (`resizable-image.tsx`): read-only — одинарный клик открывает
  просмотр; в режиме редактирования одинарный клик = выделение (ресайз,
  выравнивание — как сейчас), открывают **двойной клик** и новая кнопка
  «Просмотр» (ZoomInIcon) в плавающем тулбаре.
- **fileAttachment** (`file-attachment.tsx`): клик по карточке вызывает
  коллбек в обоих режимах; hover-иконка скачивания остаётся. Приложение
  решает: просматриваемый тип → панель, нет → скачивание (см. §3).
- **video / audio** (`video.tsx`, `audio.tsx`): клики НЕ перехватываются
  (там нативный плеер) — hover-кнопка `OpenInFullIcon` в правом верхнем углу
  вызывает коллбек.
- **drawio** (`drawio.tsx`): read-only клик → коллбек с
  `{ kind: 'diagram', svg: attrs.svg }`; фолбэк без коллбека — существующий
  `DrawioViewerDialog` (он сохраняется именно для этого случая). Режим
  редактирования не меняется: клик открывает draw.io-редактор.
  `drawio-interaction.ts` не меняется (маршрутизация клика та же).
- **mermaid / plantuml код-блоки** (`code-block.tsx`): клик по области
  отрендеренного превью (не по тулбару «Код/Просмотр») → коллбек с
  `{ kind: 'diagram', svg: <санитизированный SVG> , title: language }` —
  в обоих режимах; редактирование исходника доступно через переключатель
  «Код», как сейчас.

## 3. Определение типа просмотра

**Что.** `resolvePreviewType(mimeType, ext)` →
`'image' | 'svg' | 'pdf' | 'video' | 'audio' | 'text' | 'office' | null`.
`null` = не просматриваемый: провайдер запускает скачивание (программный
клик по `<a download>`), панель не открывается.

**Как.** Хелпер в `apps/web/src/components/page/file-preview/preview-kind.ts`
(MIME-логика живёт только в приложении, NodeView'ы всегда делегируют):

- `image` — png/jpeg/webp/gif (то, что грузится как `image/*`, кроме SVG);
- `svg` — `image/svg+xml` или ext `svg`;
- `pdf` — `application/pdf` или ext `pdf`;
- `video` / `audio` — `video/*` / `audio/*`;
- `text` — `text/plain|markdown|csv`, `application/json`; ext-фолбэк
  `txt md csv json log` (MIME у attachment клиентский, доверять только ему
  нельзя);
- `office` — doc/docx/xls/xlsx/ppt/pptx/odt/ods/odp/rtf по MIME
  (`application/msword`, `…openxmlformats…`, `…opendocument…`,
  `application/rtf`, `text/rtf`) с ext-фолбэком.

## 4. Панель, фуллскрин, состояние

**Что.** Четвёртая правая панель по образцу page-чата + полноэкранный диалог
с тем же контентом.

**Как.** Всё в `apps/web/src/components/page/file-preview/`:

- `file-preview-context.tsx` — `FilePreviewProvider` (React Context +
  useState, как `page-chat-context.tsx`): `payload | null`,
  `open(payload)` / `close()`, `mode: 'split' | 'full'` (персист
  `filePreview.displayMode`), `sidebarWidth` (персист
  `filePreview.sidebar.width`, дефолт при первом открытии — 50% вьюпорта,
  clamp 360px…70vw). Хук `useFilePreview()` — nullable, не бросает.
  Навигация на другую страницу закрывает просмотр (паттерн `prevPageId`).
- `file-preview-sidebar.tsx` — докованный режим: `Collapse
  orientation="horizontal" unmountOnExit` + `PanelResizeHandle edge="left"`
  (imperative width, `onCommit` → контекст) — копия механики
  `page-chat-sidebar.tsx:509-557`. Шапка: имя файла, «Скачать»
  (для `kind: 'file'` — `<a href={url} download>`; для диаграмм — blob-URL
  `<имя>.svg`), `OpenInFullIcon` → `mode='full'`, `CloseIcon` → `close()`.
- `file-preview-dialog.tsx` — `Dialog fullScreen` (прецедент
  `workspace-settings-dialog.tsx:269`): та же шапка, но с
  `CloseFullscreenIcon` → `mode='split'`. Esc: из фуллскрина — в сплит, из
  сплита — закрыть. На экранах `< md` (useMediaQuery) сплит недоступен —
  всегда фуллскрин, иконки переключения скрыты.
- `file-preview-content.tsx` — switch по `resolvePreviewType`; общий для
  обоих режимов.

Монтирование: провайдер — в стек `workspace-layout-client.tsx:302-320`
(рядом с `PageChatProvider`), `<FilePreviewSidebar />` и
`<FilePreviewDialog />` — flex-соседями к `CommentsSidebar`/`PageChatSidebar`
(`workspace-layout-client.tsx:292-295`). `page-renderer.tsx` берёт
`useFilePreview()` и передаёт `onOpenFilePreview` в `AnyNoteEditor`;
оффсеты `EditorOutline rightOffset` (`page-renderer.tsx:762-773`) и
`PageChatFab` (`page-chat-fab.tsx:22-35`) учитывают ширину открытой панели.
`CloseFullscreenIcon` добавляется в экспорты
`packages/ui/src/components/index.ts` (`OpenInFullIcon` уже есть, :169).

## 5. Просмотрщики по типам

- **image** — `<img>` внутри нового `zoom-pan-viewport.tsx`: колесо
  (зум к курсору), drag-пан, кнопки «+/−/по размеру/100%», двойной клик —
  toggle fit/100%. Самостоятельная реализация (~100 строк);
  `@repo/diagram-board` не импортируем (его barrel тянет Monaco).
- **svg и `kind: 'diagram'`** — fetch байтов (SVG-файл) или готовая
  разметка/data-URI (диаграмма) → `Blob {type: 'image/svg+xml'}` →
  `URL.createObjectURL` → `<img>` в том же zoom-pan. В `<img>`-контексте
  скрипты не выполняются — серверный запрет inline-SVG
  (`file-validation.ts isInlineSafeMime`) не трогаем; `Content-Disposition:
  attachment` не мешает `fetch()`. `revokeObjectURL` на unmount.
- **pdf** — `<iframe src={url} title={name}>` на весь контент-бокс: роут
  `/api/files/[id]` уже отдаёт `application/pdf` inline + nosniff, браузер
  показывает свой просмотрщик (зум/страницы/поиск бесплатно).
- **video / audio** — нативные `<video controls>` / `<audio controls>`
  (URL через `normalizeLinkHref`, как в NodeView'ах).
- **text** — `fileSize ≤ 1 МБ`: fetch → `<pre>` (моноширинный,
  `overflow: auto`); больше — плашка «Файл слишком большой» + кнопка
  скачивания.
- **office** — `<iframe src={`/api/files/${id}/preview-pdf`}>` (id
  извлекается из `/api/files/<id>`-URL). Пока конвертация идёт — спиннер
  средствами iframe-обвязки; ошибка роута → плашка с кнопкой скачивания.

## 6. Роут конвертации office → PDF

**Что.** `GET /api/files/[id]/preview-pdf` (`runtime='nodejs'`) — отдаёт
PDF-рендер office-файла, кэшируя результат в S3 по контент-хэшу.

**Как.**

- **Авторизация** — общая с `/api/files/[id]`: существующая логика
  (owner / участник workspace / PageFile-связь, ACTIVE, expiresAt)
  извлекается в `apps/web/src/lib/file-access.ts` →
  `authorizeFileRead(fileId, session)`; оба роута используют его — дублей
  не остаётся, поведение старого роута не меняется.
- **Гейт типа**: `resolvePreviewType` должен вернуть `'office'`, иначе 415.
- **Кэш**: ключ `preview-pdf/${file.hash}.pdf`; `storage.exists()` → отдать;
  иначе `storage.get(file.path)` → `officeToPdf(bytes, name)` →
  `storage.put` → отдать. Заголовки: `application/pdf`,
  `Content-Disposition: inline`, `Cache-Control: private, max-age=86400`,
  `X-Content-Type-Options: nosniff`.
- **`officeToPdf`** — новый экспорт `@repo/page-export`
  (`src/office-to-pdf.ts`): POST `${GOTENBERG_URL}/forms/libreoffice/convert`
  (multipart, оригинальное имя файла — LibreOffice определяет формат по
  расширению), таймаут и типизированные ошибки — те же
  `GotenbergTimeoutError/UnreachableError/UpstreamError`, что у `htmlToPdf`;
  роут мапит их в 504/502 (образец — экспорт-роут
  `export/[format]/route.ts:115-118`). NodeNext-чистый, erasable-only —
  как остальной пакет. `GOTENBERG_URL` уже в env web — новых переменных нет.

## 7. Вне скоупа (осознанно)

- Глубокие ссылки на просмотр (`?fileId=`) — панель эфемерна; диаграммы
  всё равно не адресуемы.
- CSV как таблица, кастомный pdfjs-просмотрщик, галерея «следующий/предыдущий
  файл страницы».
- Просмотр на публичных страницах и в template-редакторе (там нет провайдера —
  корректный фолбэк на текущее поведение).
- Интеграция с таблицей файлов в настройках workspace и записями встреч —
  кандидаты на follow-up: `open()` доступен из любого места под провайдером.

## 8. Тестирование

- **Юниты web** (`apps/web/test/`): `resolvePreviewType` (MIME + ext-фолбэки,
  office-список); `preview-pdf`-роут — 401/403 (переиспользование
  `authorizeFileRead`), 415 на не-office, кэш-хит (Gotenberg не вызывается),
  конвертация с моком Gotenberg, маппинг 504/502.
- **Юниты editor** (`packages/editor`): клик-поведение по узлам — image
  (read-only клик / edit dblclick / кнопка тулбара), fileAttachment
  (коллбек с payload), drawio (фолбэк на диалог без коллбека), code-block
  (клик по превью отдаёт SVG) — образец `drawio-interaction.test.ts`.
- **Контекст**: open/close, переключение режимов, персист localStorage,
  сброс при смене страницы.
- **E2E** (`apps/e2e/file-preview.spec.ts`): вставка изображения → клик →
  сплит-панель открыта (документ виден слева) → `OpenInFullIcon` → фуллскрин →
  `CloseFullscreenIcon` → снова сплит → закрытие. Без перезагрузки страницы
  (в E2E нет yjs-персиста).
- Полный `pnpm gates` перед merge.
