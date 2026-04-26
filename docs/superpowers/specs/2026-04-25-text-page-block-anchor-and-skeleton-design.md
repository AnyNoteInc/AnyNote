# TEXT page: block-anchor scroll/highlight + content skeleton

**Дата:** 2026-04-25
**Статус:** Draft

## Цель

Улучшить UX страниц с `pageType === 'TEXT'`:

1. **Block-anchor навигация из чата.** Ассистент чата вставляет markdown-ссылки вида
   `[title](/workspaces/{workspaceId}/pages/{pageId}#N)`, где `N` — 0-based индекс
   верхнеуровневого блока в Tiptap-документе. При переходе по такой ссылке страница
   должна:
   - выполнить client-side навигацию (без full reload);
   - проскроллить целевой блок к вертикальной середине вьюпорта;
   - подсветить блок мягким светло-жёлтым фоном на 3 секунды с плавным фейдом.

2. **Skeleton при загрузке TEXT-контента.** Сейчас между фазами
   "RSC fetch → dynamic-import редактора → создание Y.Doc → готовый редактор"
   виден заметный flash (спиннер → пустой box). Заменить на единый skeleton,
   совпадающий по геометрии с уже существующим `loading.tsx`.

## Не-цели

- Не меняем формат block-anchor URL (`#N` остаётся 0-based).
- Не меняем поведение скролла/подсветки для других типов страниц
  (`EXCALIDRAW`, `GENOGRAM` — у них своя UX-модель).
- Не вводим именованные/UUID-якоря для блоков. Если в будущем потребуется
  стабильный якорь, переживающий перестановку блоков, это отдельная задача.
- Не трогаем рендеринг tool-parts или attachment-частей в чате — только
  text-part с markdown-ссылками.

## Контекст

### Block index = позиция в `doc.content`

E2E-тест `apps/e2e/rag-block-links.spec.ts` (строки 130–187) фиксирует контракт:
для документа `{ content: [paragraph, heading, paragraph] }` ассистент генерирует
ссылку с хешем `#2` на третий top-level узел. Индекс совпадает с позицией в
массиве `doc.content.children`. Блок-anchor pipeline в `apps/agents` использует
ту же нумерацию.

### Текущий рендер чата

`packages/ui/src/components/chat/chat-message-content.tsx:67` рендерит markdown
через `<ReactMarkdown>{part.text}</ReactMarkdown>` без кастомных компонентов →
ссылки превращаются в обычные `<a href="...">`, клик вызывает full page reload.

### Текущая загрузка TEXT-страницы

1. RSC fetch → срабатывает `loading.tsx` (page-level skeleton — содержит шапку и
   несколько строк контента).
2. `PageRenderer` смонтирован, `next/dynamic`-импорт `AnyNoteEditor` →
   `<CenteredSpinner />` (просто `<CircularProgress />`).
3. `AnyNoteEditor` смонтирован, `useEffect` создаёт `Y.Doc` + `HocuspocusProvider`
   асинхронно → пока `resources` равно `null`, рендерится пустой
   `<Box className="anynote-editor" />`.
4. `useEditor` инициализирует tiptap → `EditorContent` рендерит документ.

Между шагами 2–4 виден flash: спиннер → пустой бокс → контент.

### Скролл-контейнер

Внешний скролл — `Box sx={{ flex: 1, overflow: "auto" }}` в
`apps/web/src/components/workspace/workspace-layout-client.tsx:134`.
`scrollIntoView({ block: 'center', behavior: 'smooth' })` корректно отработает
именно этот контейнер (браузер сам найдёт ближайший scrollable ancestor).

> **Implementation update 2026-04-26.** During Task 10 (E2E) the original
> direct-DOM `classList.add('block-flash')` approach was found to be wiped
> by y-prosemirror's initial Hocuspocus sync (which dispatches a transaction
> rebuilding child nodes). The implementation was migrated to a
> ProseMirror-native plugin: `BlockIndexAttributes` now stores a
> `flashIndex` in plugin state and emits the `block-flash` class via
> `Decoration.node`. `scrollToBlockIndex` dispatches `setMeta(blockFlashKey, …)`
> transactions instead of touching the DOM. Class survives any subsequent
> PM transaction. The `Подсветка одного блока несколько раз` edge case in
> the section below is now handled automatically by single-flashIndex
> semantics (setting a new flashIndex implicitly clears the old).
> See commit `7c05847` for the change.

## Архитектура

### Слои изменений

| #   | Слой          | Ответственность                                                                                                                                                          | Файлы                                                                                                                                                                        |
| --- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | UI пакет      | `ChatMessageContent` принимает опциональный `renderLink`, прокидывает в `react-markdown` через `components.a`                                                            | `packages/ui/src/components/chat/chat-message-content.tsx`, `chat-message-list.tsx`                                                                                          |
| 2   | Web app       | Реализует `renderLink`: внутренние href (`/workspaces/...`) → `next/link`, остальное → `<a target="_blank" rel="noopener noreferrer">`                                   | новый `apps/web/src/components/chat/chat-link-renderer.tsx`, использован там, где монтируется `ChatMessageList`                                                              |
| 3   | Editor пакет  | Tiptap-extension `BlockIndexAttributes` декорирует top-level узлы атрибутом `data-block-index="N"`; утилита `scrollToBlockIndex(editor, index)` экспортируется из пакета | `packages/editor/src/extensions/block-index-attributes.ts`, `packages/editor/src/block-anchor.ts`, `packages/editor/src/extensions/index.ts`, `packages/editor/src/index.ts` |
| 4   | PageRenderer  | Реагирует на `window.location.hash` (mount + `hashchange`); после готовности редактора зовёт `scrollToBlockIndex` с retry                                                | `apps/web/src/components/page/page-renderer.tsx`                                                                                                                             |
| 5   | TEXT skeleton | Общий `EditorContentSkeleton` заменяет `CenteredSpinner` для TEXT-варианта `next/dynamic` и пустое состояние внутри `AnyNoteEditor`                                      | новый `apps/web/src/components/page/editor-content-skeleton.tsx`, `packages/editor/src/anynote-editor.tsx` (новый prop `loadingFallback`), `packages/editor/src/types.ts`    |
| 6   | Подсветка CSS | Класс `.block-flash` со светло-жёлтым фоном и плавным transition                                                                                                         | `packages/editor/src/styles/content.css`                                                                                                                                     |

### Поток клика по chat-ссылке

```
Клик [title](/workspaces/W/pages/P#2)
   ↓
ReactMarkdown → renderLink("/workspaces/W/pages/P#2", "title") → <Link href=...>
   ↓
Next router.push (client-side)
   ↓
RSC tRPC fetch — loading.tsx skeleton
   ↓
PageRenderer mount; хеш #2 уже в URL
   ↓
AnyNoteEditor mount → EditorContentSkeleton (dynamic-fallback → ydoc init fallback)
   ↓
onReady(editor) → setEditorReady(true)
   ↓
useEffect: scrollToBlockIndex(editor, 2)
   ↓
querySelector('[data-block-index="2"]') → scrollIntoView({block:'center', smooth})
   ↓
classList.add('block-flash') → 3s setTimeout → classList.remove('block-flash')
```

### Block-index decorations (Tiptap extension)

Используется ProseMirror `Decoration.node`, не модификация схемы. Это
гарантирует:

- атрибуты не попадают в Y.Doc (никаких race-conditions с другими клиентами);
- атрибуты пересчитываются автоматически при каждом изменении документа
  (вставил блок выше → индексы сдвинулись → атрибуты обновились);
- никакая существующая extension/extension-конфигурация не ломается.

```ts
// packages/editor/src/extensions/block-index-attributes.ts
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const BlockIndexAttributes = Extension.create({
  name: 'blockIndexAttributes',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('blockIndexAttributes'),
        props: {
          decorations(state) {
            const decos: Decoration[] = []
            state.doc.content.forEach((node, offset, index) => {
              decos.push(
                Decoration.node(offset, offset + node.nodeSize, {
                  'data-block-index': String(index),
                }),
              )
            })
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
})
```

Регистрируется в `buildExtensions(...)` (`packages/editor/src/extensions/index.ts`).

### `scrollToBlockIndex`

```ts
// packages/editor/src/block-anchor.ts
import type { Editor } from '@tiptap/core'

export function scrollToBlockIndex(editor: Editor, index: number): boolean {
  const root = editor.view.dom
  const target = root.querySelector(`[data-block-index="${index}"]`)
  if (!(target instanceof HTMLElement)) return false
  target.scrollIntoView({ block: 'center', behavior: 'smooth' })
  target.classList.add('block-flash')
  window.setTimeout(() => target.classList.remove('block-flash'), 3000)
  return true
}
```

Возвращает `boolean`, чтобы вызывающий код мог понять, удалось ли найти блок,
и решить — делать ретрай или нет.

### Подсветка (CSS)

```css
/* packages/editor/src/styles/content.css */
.anynote-editor .ProseMirror .block-flash {
  background-color: #fff9c4; /* MUI yellow.100 */
  border-radius: 4px;
  transition: background-color 0.6s ease-out;
}
```

Когда класс снимается, `background-color` возвращается к дефолту через
600ms transition → плавный fade-out. Без keyframes/JS-анимации.

### `EditorContentSkeleton`

```tsx
// apps/web/src/components/page/editor-content-skeleton.tsx
'use client'

import { Box, Skeleton, Stack } from '@repo/ui/components'
import { pageColumnSx } from './column-sx'

export function EditorContentSkeleton() {
  return (
    <Box sx={{ ...pageColumnSx, py: 2 }}>
      <Stack spacing={1.25}>
        <Skeleton variant="text" height={24} />
        <Skeleton variant="text" height={24} width="90%" />
        <Skeleton variant="text" height={24} width="75%" />
        <Skeleton variant="rectangular" height={160} sx={{ borderRadius: 1, mt: 2 }} />
        <Skeleton variant="text" height={24} />
        <Skeleton variant="text" height={24} width="85%" />
      </Stack>
    </Box>
  )
}
```

Геометрия совпадает с контентной частью `loading.tsx` → пользователь не видит
прыжков layout между фазами.

### Изменение `AnyNoteEditor`

Новый опциональный prop `loadingFallback?: ReactNode` в `AnyNoteEditorProps`
(`packages/editor/src/types.ts`). В `AnyNoteEditor`:

```tsx
if (!resources) {
  return (
    props.loadingFallback ?? (
      <Box className={`anynote-editor ${props.className ?? ''}`} sx={{ height: '100%' }} />
    )
  )
}
```

Дефолт сохранён для обратной совместимости.

### `PageRenderer`: hash-эффект

```tsx
const [editorReady, setEditorReady] = useState(false)

const handleEditorReady = useCallback(
  (editor: Editor) => {
    editorRef.current = editor
    pageEditor.setEditor(editor)
    setEditorReady(true)
  },
  [pageEditor],
)

useEffect(() => {
  if (!editorReady) return
  const editor = editorRef.current
  if (!editor) return

  const apply = () => {
    const hash = window.location.hash.slice(1)
    if (!hash) return
    const index = Number.parseInt(hash, 10)
    if (Number.isNaN(index)) return
    let attempts = 0
    const tryScroll = () => {
      if (scrollToBlockIndex(editor, index)) return
      if (++attempts < 10) window.setTimeout(tryScroll, 150)
    }
    tryScroll()
  }

  apply()
  window.addEventListener('hashchange', apply)
  return () => window.removeEventListener('hashchange', apply)
}, [editorReady])
```

Retry-логика покрывает редкий случай, когда `onCreate` уже сработал, но
ProseMirror ещё не успел применить decorations к DOM (между tick'ами).
10 попыток × 150ms = 1.5s максимум.

### `ChatMessageContent`: prop `renderLink`

```tsx
type RenderLink = (href: string, children: ReactNode) => ReactNode

type ChatMessageContentProps = {
  parts: ChatMessagePart[]
  renderLink?: RenderLink
}

// внутри:
;<ReactMarkdown
  components={
    renderLink
      ? {
          a: ({ href, children }) => (href ? <>{renderLink(href, children)}</> : <>{children}</>),
        }
      : undefined
  }
>
  {part.text}
</ReactMarkdown>
```

`ChatMessageList` пробрасывает prop дальше:

```tsx
type ChatMessageListProps = {
  // ... existing props
  renderLink?: RenderLink
}

// внутри:
;<ChatMessageContent parts={message.parts} renderLink={renderLink} />
```

### Web-app `chat-link-renderer`

```tsx
// apps/web/src/components/chat/chat-link-renderer.tsx
'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'

const INTERNAL_PREFIX = '/'

export function renderChatLink(href: string, children: ReactNode): ReactNode {
  const isInternal = href.startsWith(INTERNAL_PREFIX) && !href.startsWith('//')
  if (isInternal) {
    return <Link href={href}>{children}</Link>
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}
```

Подключается там, где сейчас рендерится `<ChatMessageList ... />` в web-app —
передачей prop `renderLink={renderChatLink}`.

## Тесты

### Unit (vitest)

- `packages/ui/test/chat-message-content.test.tsx`:
  - default: ссылка `[x](/foo)` рендерится как `<a href="/foo">x</a>`;
  - с `renderLink`: вызывается с правильным `href`, результат подставляется
    вместо дефолтного `<a>`.
- `packages/editor/` (если в пакете есть vitest-setup; иначе через E2E):
  - после `editor.create({ content: { type: 'doc', content: [p, h, p] } })`
    DOM содержит `[data-block-index="0"]`, `="1"`, `="2"`;
  - после вставки нового блока в начало индексы сдвинулись.

### E2E (Playwright)

Новый spec `apps/e2e/page-block-anchor.spec.ts`:

1. Прямой переход с хешем: открыть `/workspaces/W/pages/P#2` →
   `[data-block-index="2"]` в DOM, имеет computed `background-color`
   `rgb(255, 249, 196)` в первые ~2s, после 3s background вернулся к дефолту.
2. Клик по chat-ссылке (используем существующую инфраструктуру `rag-block-links.spec.ts`):
   - после полной загрузки чата кликаем по `<a>`-якорю на блок;
   - URL обновился без full reload (проверяем по reload counter / отсутствию
     window-level navigation event);
   - таргет-блок подсвечен.
3. Невалидный хеш `#header-foo` → ошибки нет, ничего не происходит.
4. Хеш на несуществующий индекс `#999` → ошибки нет, через ~1.5s попытки
   прекращаются.

Существующий `rag-block-links.spec.ts` не модифицируем — он покрывает
генерацию ссылок ассистентом.

## Edge cases и риски

- **Strict-mode двойной mount.** `setEditorReady(true)` идемпотентен;
  `useEffect` cleanup корректно снимает `hashchange` listener.
- **Подсветка одного блока несколько раз.** Если пользователь кликает по той
  же ссылке (`hashchange` не сработает, т.к. хеш не изменился) — не
  скроллим повторно. Это окей: повторный клик по тому же якорю — редкий
  кейс. Если будет фидбек — добавим повторный trigger через router event.
- **Y.Doc медленно синкается.** Контент всегда seedится из `Page.contentYjs`
  до создания tiptap → `onCreate` вызывается уже с актуальным состоянием на
  момент последней синхронизации с outbox. Свежие правки от других клиентов
  могут прийти позже, но они не сломают подсветку (decorations пересчитаются,
  атрибут останется на нужном узле, если индекс не сдвинулся).
- **Индекс сдвинулся между генерацией ссылки и кликом.** Возможно (например,
  кто-то добавил блок выше). Принимаем как известное ограничение MVP — это
  trade-off номерной нумерации vs UUID-anchors. Подсветится "не тот" блок,
  но это не критично; в будущем можно перейти на стабильные anchors.
- **Безопасность markdown-ссылок.** Внутренние ссылки (`/...`) пускаем через
  `next/link` — он не выполнит JavaScript URL. Внешние получают
  `rel="noopener noreferrer"`. URL вида `javascript:` или `data:` не
  начинаются с `/` → попадают в "внешние" ветку. Чтобы не открывать опасные
  URL в новой вкладке, добавим whitelist `http(s):` для внешних, остальное
  — отрисовать как plain text (без `<a>`).
- **Тип хеша.** Поддерживаем только числовой `#N`. Любой другой хеш игнорим.
- **Фейд через transition.** Если пользователь быстро кликает по нескольким
  ссылкам подряд (на одну страницу), таймер `setTimeout` для предыдущей
  подсветки может стрелять после новой. Решение: при каждом новом скролле
  снимаем `block-flash` с любого ранее подсвеченного элемента в `.ProseMirror`
  перед добавлением нового.

## Производительность

- ProseMirror plugin `decorations` пересчитывается при каждом state change.
  Для документов на сотни блоков это всё ещё O(N) — приемлемо.
- Подсветка через CSS-transition (GPU-композиция фона) → не вызывает layout
  reflow.
- `EditorContentSkeleton` использует MUI `Skeleton` (стандартный animated
  pulse) — без специфичных тяжёлых эффектов.

## План имплементации (high-level)

Конкретный пошаговый план будет создан skill'ом `writing-plans` после approval
этого spec. Ожидаемая разбивка:

1. Editor: `BlockIndexAttributes` extension + регистрация + unit-тест.
2. Editor: `scrollToBlockIndex` + CSS `.block-flash`.
3. Editor: prop `loadingFallback` в `AnyNoteEditor`.
4. Web: `EditorContentSkeleton` + замена `CenteredSpinner` на skeleton в
   TEXT-варианте `PageRenderer`.
5. Web: hash-effect в `PageRenderer`.
6. UI пакет: prop `renderLink` в `ChatMessageContent` и `ChatMessageList` +
   обновление unit-теста.
7. Web: `renderChatLink` + подключение в чат-список.
8. E2E: `apps/e2e/page-block-anchor.spec.ts`.
9. Manual smoke: открыть страницу с хешем, кликнуть по ссылке из чата,
   убедиться что skeleton непрерывен.
