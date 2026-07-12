# File Preview Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Клик по загруженному файлу/схеме на TEXT-странице открывает просмотр содержимого в правой сплит-панели (~50% экрана) с переключением в полноэкранный режим (`OpenInFullIcon` ↔ `CloseFullscreenIcon`).

**Architecture:** Редактор (`@repo/editor`) только сообщает о клике через новый опциональный коллбек `onOpenFilePreview(payload)`, протянутый в опции шести расширений. Вся UI-логика живёт в `apps/web`: контекст + докованная панель (копия механики page-чата) + `Dialog fullScreen`. PDF показывает встроенный просмотрщик браузера (iframe на `/api/files/<id>`), office-форматы конвертирует Gotenberg LibreOffice через новый роут `/api/files/<id>/preview-pdf` с S3-кэшем по `File.hash`.

**Tech Stack:** React 19 + MUI v6 (`@repo/ui/components`), Tiptap NodeViews, Next.js route handlers (`runtime='nodejs'`), Gotenberg (`@repo/page-export`), vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-11-file-preview-viewer-design.md`. Ветка: `feat/file-preview-viewer` (уже создана).

**Отклонение от спеки (осознанное):** `resolvePreviewType` живёт в `apps/web/src/lib/preview-kind.ts` (не в `components/page/file-preview/`) — его импортирует и роут `preview-pdf`, и компоненты; роуты не должны импортировать из `components/`.

---

## Общие контракты (используются во всех задачах)

```ts
// packages/editor/src/types.ts (Task 2)
export type FilePreviewFilePayload = {
  kind: 'file'
  url: string
  name: string | null
  mimeType: string | null
  size: number | null
}
export type FilePreviewDiagramPayload = {
  kind: 'diagram'
  /** Raw SVG markup ('<svg …') ИЛИ data:image/svg+xml URI (drawio). */
  svg: string
  title?: string
}
export type FilePreviewPayload = FilePreviewFilePayload | FilePreviewDiagramPayload
export type OpenFilePreview = (payload: FilePreviewPayload) => void
```

```ts
// apps/web/src/lib/preview-kind.ts (Task 1)
export type PreviewType = 'image' | 'svg' | 'pdf' | 'video' | 'audio' | 'text' | 'office'
resolvePreviewType(mimeType: string | null, ext: string | null): PreviewType | null
extFromFileName(name: string | null): string | null
extractApiFileId(url: string): string | null
TEXT_PREVIEW_MAX_BYTES = 1_048_576
```

Прогон тестов: `pnpm --filter web exec vitest run test/<file>` (web),
`pnpm --filter @repo/editor exec vitest run src/extensions/<file>` (editor),
`pnpm --filter @repo/page-export test` (page-export).

**Prettier:** `semi: false`, одинарные кавычки, trailing commas, 100 колонок. Запускай `pnpm format` при сомнении. Коммиты БЕЗ `--no-verify`, но husky-хук в этом чекауте не гоняет gates — финальный `pnpm gates` обязателен (Task 15).

---

### Task 1: `preview-kind.ts` — определение типа просмотра

**Files:**
- Create: `apps/web/src/lib/preview-kind.ts`
- Test: `apps/web/test/preview-kind.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/test/preview-kind.test.ts
import { describe, expect, it } from 'vitest'

import {
  TEXT_PREVIEW_MAX_BYTES,
  extFromFileName,
  extractApiFileId,
  resolvePreviewType,
} from '../src/lib/preview-kind'

describe('resolvePreviewType', () => {
  it('classifies svg by mime and by ext (before generic image/*)', () => {
    expect(resolvePreviewType('image/svg+xml', null)).toBe('svg')
    expect(resolvePreviewType('application/octet-stream', 'svg')).toBe('svg')
  })

  it('classifies pdf by mime and by ext', () => {
    expect(resolvePreviewType('application/pdf', null)).toBe('pdf')
    expect(resolvePreviewType(null, 'pdf')).toBe('pdf')
  })

  it('classifies raster images, video and audio by mime family', () => {
    expect(resolvePreviewType('image/png', null)).toBe('image')
    expect(resolvePreviewType('image/webp', 'webp')).toBe('image')
    expect(resolvePreviewType('video/mp4', null)).toBe('video')
    expect(resolvePreviewType('audio/mpeg', null)).toBe('audio')
  })

  it('classifies text by mime and by ext fallback (attachment mime is client-declared)', () => {
    expect(resolvePreviewType('text/plain', null)).toBe('text')
    expect(resolvePreviewType('text/markdown', null)).toBe('text')
    expect(resolvePreviewType('application/json', null)).toBe('text')
    expect(resolvePreviewType('application/octet-stream', 'md')).toBe('text')
    expect(resolvePreviewType(null, 'log')).toBe('text')
  })

  it('classifies office formats by mime and by ext fallback', () => {
    expect(
      resolvePreviewType(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        null,
      ),
    ).toBe('office')
    expect(resolvePreviewType('application/msword', null)).toBe('office')
    expect(resolvePreviewType('application/vnd.oasis.opendocument.text', null)).toBe('office')
    expect(resolvePreviewType('application/octet-stream', 'xlsx')).toBe('office')
    expect(resolvePreviewType(null, 'pptx')).toBe('office')
    expect(resolvePreviewType('text/rtf', null)).toBe('office')
  })

  it('is case-insensitive and tolerates a leading dot in ext', () => {
    expect(resolvePreviewType('APPLICATION/PDF', null)).toBe('pdf')
    expect(resolvePreviewType(null, '.DOCX')).toBe('office')
  })

  it('returns null for unknown types', () => {
    expect(resolvePreviewType('application/zip', 'zip')).toBeNull()
    expect(resolvePreviewType(null, null)).toBeNull()
    expect(resolvePreviewType('', '')).toBeNull()
  })
})

describe('extFromFileName', () => {
  it('extracts the lowercased extension', () => {
    expect(extFromFileName('Отчёт.DOCX')).toBe('docx')
    expect(extFromFileName('archive.tar.gz')).toBe('gz')
  })

  it('returns null without an extension or name', () => {
    expect(extFromFileName('README')).toBeNull()
    expect(extFromFileName(null)).toBeNull()
    expect(extFromFileName('')).toBeNull()
  })
})

describe('extractApiFileId', () => {
  it('extracts the uuid from an /api/files url', () => {
    expect(extractApiFileId('/api/files/0197a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b')).toBe(
      '0197a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    )
  })

  it('returns null for foreign or malformed urls', () => {
    expect(extractApiFileId('https://evil.example/api/files/x')).toBeNull()
    expect(extractApiFileId('/api/files/not-a-uuid')).toBeNull()
    expect(extractApiFileId('/api/files/0197a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b/preview-pdf')).toBeNull()
  })
})

it('caps text preview at 1 MB', () => {
  expect(TEXT_PREVIEW_MAX_BYTES).toBe(1_048_576)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run test/preview-kind.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/preview-kind'`

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/src/lib/preview-kind.ts
// Single source of truth for «что можно показать в просмотрщике файлов».
// Consumed by the file-preview UI (apps/web/src/components/page/file-preview/)
// and by the office-conversion route (/api/files/[id]/preview-pdf).
//
// Attachment MIME types are client-declared (file-validation.ts accepts any),
// so every family also has an extension fallback.

export type PreviewType = 'image' | 'svg' | 'pdf' | 'video' | 'audio' | 'text' | 'office'

/** Files above this are not fetched for the text preview — download prompt instead. */
export const TEXT_PREVIEW_MAX_BYTES = 1_048_576

const TEXT_MIME = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json'])
const TEXT_EXT = new Set(['txt', 'md', 'csv', 'json', 'log'])

const OFFICE_MIME = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/rtf',
  'text/rtf',
])
const OFFICE_EXT = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf'])

const normalizeExt = (ext: string | null): string =>
  (ext ?? '').toLowerCase().replace(/^\./, '')

export function extFromFileName(name: string | null): string | null {
  const match = (name ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)
  return match?.[1] ?? null
}

export function resolvePreviewType(
  mimeType: string | null,
  ext: string | null,
): PreviewType | null {
  const mime = (mimeType ?? '').toLowerCase()
  const extension = normalizeExt(ext)
  // SVG first — it matches image/* but needs the blob-in-<img> path (XSS-safe).
  if (mime === 'image/svg+xml' || extension === 'svg') return 'svg'
  if (mime === 'application/pdf' || extension === 'pdf') return 'pdf'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  // text/rtf is an OFFICE format (LibreOffice renders it), not a plain-text one.
  if (OFFICE_MIME.has(mime) || OFFICE_EXT.has(extension)) return 'office'
  if (TEXT_MIME.has(mime) || TEXT_EXT.has(extension)) return 'text'
  return null
}

/** '/api/files/<uuid>' → '<uuid>'; null для любых других URL (внешние ссылки). */
export function extractApiFileId(url: string): string | null {
  const match = url.match(/^\/api\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/)
  return match?.[1] ?? null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run test/preview-kind.test.ts`
Expected: PASS (все кейсы). ВНИМАНИЕ: тест «text/rtf → office» проходит потому, что office-проверка стоит ДО text-проверки — не переставляй их.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/preview-kind.ts apps/web/test/preview-kind.test.ts
git commit -m "feat(web): resolvePreviewType — классификация файлов для просмотрщика"
```

---

### Task 2: Контракт редактора — типы, interaction-хелперы, протяжка опции

**Files:**
- Modify: `packages/editor/src/types.ts` (типы + проп)
- Modify: `packages/editor/src/index.ts` (экспорт типов)
- Modify: `packages/editor/src/extensions/index.ts` (BuildExtensionsOptions + configure)
- Modify: `packages/editor/src/anynote-editor.tsx:447-468` (проброс пропа)
- Modify: `packages/editor/src/extensions/resizable-image.tsx:24-26,378-384` (поле опции)
- Modify: `packages/editor/src/extensions/video.tsx:20-22,321-327` (поле опции)
- Modify: `packages/editor/src/extensions/audio.tsx` (поле опции, по образцу video)
- Modify: `packages/editor/src/extensions/file-attachment.tsx:185-189` (добавить addOptions)
- Modify: `packages/editor/src/extensions/drawio.tsx:14-16,92-95` (поле опции)
- Modify: `packages/editor/src/extensions/code-block.tsx:106-108` (поле опции)
- Create: `packages/editor/src/extensions/file-preview-interaction.ts`
- Test: `packages/editor/src/extensions/file-preview-interaction.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/editor/src/extensions/file-preview-interaction.test.ts
import { describe, expect, it } from 'vitest'

import {
  attachmentPreviewPayload,
  imagePreviewPayload,
  mediaPreviewPayload,
  shouldOpenImagePreview,
} from './file-preview-interaction'

describe('shouldOpenImagePreview', () => {
  it('read-only: одинарный клик открывает просмотр', () => {
    expect(shouldOpenImagePreview({ isEditable: false, isDoubleClick: false })).toBe(true)
  })

  it('editable: одинарный клик — только выделение (ресайз/тулбар)', () => {
    expect(shouldOpenImagePreview({ isEditable: true, isDoubleClick: false })).toBe(false)
  })

  it('двойной клик открывает просмотр в обоих режимах', () => {
    expect(shouldOpenImagePreview({ isEditable: true, isDoubleClick: true })).toBe(true)
    expect(shouldOpenImagePreview({ isEditable: false, isDoubleClick: true })).toBe(true)
  })
})

describe('imagePreviewPayload', () => {
  it('собирает file-payload из атрибутов image-ноды', () => {
    expect(
      imagePreviewPayload({ src: '/api/files/abc', name: 'a.png', size: 10, mimeType: 'image/png' }),
    ).toEqual({ kind: 'file', url: '/api/files/abc', name: 'a.png', mimeType: 'image/png', size: 10 })
  })

  it('null без src (пустой плейсхолдер)', () => {
    expect(imagePreviewPayload({ src: null, name: null, size: null, mimeType: null })).toBeNull()
  })

  it('image-ноды без метаданных (legacy) дают null-поля, mimeType добирается из image/*', () => {
    expect(
      imagePreviewPayload({ src: '/api/files/abc', name: null, size: null, mimeType: null }),
    ).toEqual({ kind: 'file', url: '/api/files/abc', name: null, mimeType: 'image/*', size: null })
  })
})

describe('attachmentPreviewPayload / mediaPreviewPayload', () => {
  it('маппит атрибуты fileAttachment', () => {
    expect(
      attachmentPreviewPayload({ url: '/api/files/x', name: 'r.pdf', size: 5, mimeType: 'application/pdf', ext: 'pdf' }),
    ).toEqual({ kind: 'file', url: '/api/files/x', name: 'r.pdf', mimeType: 'application/pdf', size: 5 })
  })

  it('маппит атрибуты video/audio-нод, пустые строки → null', () => {
    expect(mediaPreviewPayload({ url: '/api/files/v', name: '', size: 0, mimeType: '' })).toEqual({
      kind: 'file',
      url: '/api/files/v',
      name: null,
      mimeType: null,
      size: null,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/editor exec vitest run src/extensions/file-preview-interaction.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `file-preview-interaction.ts`**

```ts
// packages/editor/src/extensions/file-preview-interaction.ts
// Pure click-routing + payload builders for the file-preview feature (spec §2).
// No React, no Tiptap — unit-tested alone (the drawio-interaction.ts pattern).

import type { FilePreviewFilePayload } from '../types'
import type { FileAttachmentAttrs, MediaNodeAttrs } from './media-mime'

/** image-нода: read-only открывает просмотр одинарным кликом; в режиме
 *  редактирования одинарный клик оставлен выделению (ресайз/выравнивание),
 *  просмотр — по двойному клику (и по кнопке тулбара). */
export const shouldOpenImagePreview = (args: {
  isEditable: boolean
  isDoubleClick: boolean
}): boolean => !args.isEditable || args.isDoubleClick

export const imagePreviewPayload = (attrs: {
  src: string | null
  name: string | null
  size: number | null
  mimeType: string | null
}): FilePreviewFilePayload | null => {
  if (!attrs.src) return null
  return {
    kind: 'file',
    url: attrs.src,
    name: attrs.name,
    // Legacy images have no stamped mimeType — 'image/*' still routes to the
    // raster viewer in apps/web resolvePreviewType.
    mimeType: attrs.mimeType || 'image/*',
    size: attrs.size,
  }
}

export const attachmentPreviewPayload = (attrs: FileAttachmentAttrs): FilePreviewFilePayload => ({
  kind: 'file',
  url: attrs.url,
  name: attrs.name || null,
  mimeType: attrs.mimeType || null,
  size: attrs.size || null,
})

export const mediaPreviewPayload = (attrs: MediaNodeAttrs): FilePreviewFilePayload => ({
  kind: 'file',
  url: attrs.url,
  name: attrs.name || null,
  mimeType: attrs.mimeType || null,
  size: attrs.size || null,
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @repo/editor exec vitest run src/extensions/file-preview-interaction.test.ts`
Expected: PASS

- [ ] **Step 5: Add types to `packages/editor/src/types.ts`**

После блока `UploadedFile`/`UploadHandler` (строки 101-106) вставить:

```ts
// --- File preview (просмотрщик файлов, spec 2026-07-11) --------------------
//
// The editor owns NO preview UI. apps/web injects `onOpenFilePreview`; node
// views call it with a payload and the app decides: side panel, fullscreen
// dialog, or a download fallback for non-previewable types. When absent
// (template editor, public pages) every node keeps its current behavior.

export type FilePreviewFilePayload = {
  kind: 'file'
  url: string
  name: string | null
  mimeType: string | null
  size: number | null
}

export type FilePreviewDiagramPayload = {
  kind: 'diagram'
  /** Raw SVG markup ('<svg …') OR a data:image/svg+xml URI (drawio). */
  svg: string
  title?: string
}

export type FilePreviewPayload = FilePreviewFilePayload | FilePreviewDiagramPayload

export type OpenFilePreview = (payload: FilePreviewPayload) => void
```

В `AnyNoteEditorProps` (после `generateAI?: GenerateAICallback`, строка 208) добавить:

```ts
  // apps/web injects the file-preview opener (spec §1). When present, clicks on
  // image/fileAttachment/video/audio/drawio/diagram-preview nodes open the
  // split-panel / fullscreen viewer. Absent → current behavior everywhere.
  onOpenFilePreview?: OpenFilePreview
```

- [ ] **Step 6: Export the types from `packages/editor/src/index.ts`**

В существующий `export type { … } from './types'` блок добавить (по алфавиту):

```ts
  FilePreviewDiagramPayload,
  FilePreviewFilePayload,
  FilePreviewPayload,
  OpenFilePreview,
```

- [ ] **Step 7: Add the option field to each extension (без поведения)**

`packages/editor/src/extensions/resizable-image.tsx` — расширить опции (строки 24-26 и addOptions 379-384):

```ts
import type { OpenFilePreview, UploadHandler } from '../types'

export type ResizableImageOptions = {
  uploadHandler: UploadHandler | null
  onOpenFilePreview: OpenFilePreview | null
}
```

```ts
  addOptions() {
    return {
      ...(this.parent?.() ?? {}),
      uploadHandler: null,
      onOpenFilePreview: null,
    }
  },
```

`packages/editor/src/extensions/video.tsx` (строки 20-22, 322-327) и `audio.tsx` (аналогичные места) — то же поле:

```ts
export type VideoOptions = {
  uploadHandler: UploadHandler | null
  onOpenFilePreview: OpenFilePreview | null
}
```

и в `addOptions` video.tsx:

```ts
  addOptions() {
    return {
      ...(this.parent?.() ?? {}),
      uploadHandler: null,
      onOpenFilePreview: null,
    }
  },
```

`audio.tsx` — идентичные правки:

```ts
export type AudioOptions = {
  uploadHandler: UploadHandler | null
  onOpenFilePreview: OpenFilePreview | null
}
```

```ts
  addOptions() {
    return {
      ...(this.parent?.() ?? {}),
      uploadHandler: null,
      onOpenFilePreview: null,
    }
  },
```

В обоих файлах расширить существующий импорт из `'../types'`:

```ts
import type { OpenFilePreview, UploadHandler } from '../types'
```

`packages/editor/src/extensions/file-attachment.tsx` (строки 185-189) — у расширения сейчас НЕТ опций, добавить:

```ts
import type { OpenFilePreview } from '../types'

export type FileAttachmentOptions = {
  onOpenFilePreview: OpenFilePreview | null
}

export const FileAttachment = FileAttachmentSchema.extend<FileAttachmentOptions>({
  addOptions() {
    return { onOpenFilePreview: null }
  },
  addNodeView() {
    return ReactNodeViewRenderer(FileAttachmentView)
  },
})
```

`packages/editor/src/extensions/drawio.tsx` (строки 14-16, 92-95):

```ts
import type { OpenFilePreview } from '../types'

export type DrawioOptions = {
  drawioUrl: string
  onOpenFilePreview: OpenFilePreview | null
}
```

```ts
export const Drawio = DrawioSchema.extend<DrawioOptions>({
  addOptions() {
    return { drawioUrl: '', onOpenFilePreview: null }
  },
```

`packages/editor/src/extensions/code-block.tsx` (строки 106-108):

```ts
type CodeBlockOptions = CodeBlockLowlightOptions & {
  plantumlRenderAuth?: PlantumlRenderAuth
  onOpenFilePreview?: OpenFilePreview | null
}
```

(+ `import type { OpenFilePreview } from '../types'`).

- [ ] **Step 8: Thread через `buildExtensions` и `anynote-editor`**

`packages/editor/src/extensions/index.ts`:

1. В импорт типов из `'../types'` (строки 55-61) добавить `OpenFilePreview`.
2. В `BuildExtensionsOptions` (после `askAI?`, строка 103) добавить:

```ts
  // apps/web injects the file-preview opener; node views call it on click.
  // Absent → nodes keep their current click behavior (spec §1).
  onOpenFilePreview?: OpenFilePreview
```

3. Обновить configure-вызовы:

```ts
  ResizableImage.configure({
    uploadHandler: opts.uploadHandler,
    onOpenFilePreview: opts.onOpenFilePreview ?? null,
  }),
  Video.configure({
    uploadHandler: opts.uploadHandler,
    onOpenFilePreview: opts.onOpenFilePreview ?? null,
  }),
  Audio.configure({
    uploadHandler: opts.uploadHandler,
    onOpenFilePreview: opts.onOpenFilePreview ?? null,
  }),
```

```ts
  CodeBlock.configure({
    lowlight,
    plantumlRenderAuth: opts.plantumlRenderAuth,
    onOpenFilePreview: opts.onOpenFilePreview ?? null,
  }),
```

```ts
  FileAttachment.configure({ onOpenFilePreview: opts.onOpenFilePreview ?? null }),
```

```ts
  Drawio.configure({
    drawioUrl: opts.drawioUrl,
    onOpenFilePreview: opts.onOpenFilePreview ?? null,
  }),
```

`packages/editor/src/anynote-editor.tsx` — в объект `buildExtensions({...})` (после `askAI: props.askAI,` строка 466) добавить:

```ts
        onOpenFilePreview: props.onOpenFilePreview,
```

- [ ] **Step 9: Verify types and full editor test suite**

Run: `pnpm --filter @repo/editor test && pnpm --filter @repo/editor exec tsc --noEmit`
Expected: все тесты PASS (312+ было), 0 type errors. Если в пакете нет скрипта `tsc` в PATH — `pnpm --filter @repo/editor check-types` (если есть) или положиться на финальный `pnpm check-types`.

- [ ] **Step 10: Commit**

```bash
git add packages/editor/src/types.ts packages/editor/src/index.ts \
  packages/editor/src/extensions/index.ts packages/editor/src/anynote-editor.tsx \
  packages/editor/src/extensions/resizable-image.tsx packages/editor/src/extensions/video.tsx \
  packages/editor/src/extensions/audio.tsx packages/editor/src/extensions/file-attachment.tsx \
  packages/editor/src/extensions/drawio.tsx packages/editor/src/extensions/code-block.tsx \
  packages/editor/src/extensions/file-preview-interaction.ts \
  packages/editor/src/extensions/file-preview-interaction.test.ts
git commit -m "feat(editor): контракт onOpenFilePreview — типы, хелперы, протяжка опций"
```

---

### Task 3: image-нода — клик/dblclick/кнопка «Просмотр»

**Files:**
- Modify: `packages/editor/src/extensions/resizable-image.tsx`

- [ ] **Step 1: Add the preview opener to `ResizableImageView`**

После `const uploadHandler = options.uploadHandler` (строка 51) добавить:

```ts
  const onOpenFilePreview = options.onOpenFilePreview

  const openPreview = useCallback(() => {
    if (!onOpenFilePreview) return
    const payload = imagePreviewPayload({
      src,
      name: (node.attrs.name as string | null) ?? null,
      size: (node.attrs.size as number | null) ?? null,
      mimeType: (node.attrs.mimeType as string | null) ?? null,
    })
    if (payload) onOpenFilePreview(payload)
  }, [onOpenFilePreview, src, node.attrs.name, node.attrs.size, node.attrs.mimeType])
```

Импорты: к строке 18 добавить

```ts
import { imagePreviewPayload, shouldOpenImagePreview } from './file-preview-interaction'
```

и `ZoomInIcon`:

```ts
import ZoomInIcon from '@mui/icons-material/ZoomIn'
```

- [ ] **Step 2: Wire clicks on the `<img>`**

В filled-state `<Box component="img" …>` (строки 328-343) добавить обработчики и курсор:

```tsx
            <Box
              component="img"
              ref={imgRef}
              src={src}
              alt={alt}
              title={title}
              draggable={false}
              onClick={() => {
                if (shouldOpenImagePreview({ isEditable: editor.isEditable, isDoubleClick: false }))
                  openPreview()
              }}
              onDoubleClick={() => {
                if (shouldOpenImagePreview({ isEditable: editor.isEditable, isDoubleClick: true }))
                  openPreview()
              }}
              sx={{
                display: 'block',
                maxWidth: '100%',
                height: 'auto',
                width: width ? `${width}px` : 'auto',
                borderRadius: 0.75,
                userSelect: 'none',
                cursor: onOpenFilePreview && !editor.isEditable ? 'zoom-in' : undefined,
              }}
            />
```

- [ ] **Step 3: Add the «Просмотр» toolbar button**

В плавающем тулбаре ПЕРЕД кнопкой «Скачать» (перед `<Tooltip title="Скачать" …>` на строке 290) добавить:

```tsx
              {onOpenFilePreview
                ? toolbarButton('Просмотр', <ZoomInIcon fontSize="small" />, openPreview)
                : null}
```

- [ ] **Step 4: Run editor tests + types**

Run: `pnpm --filter @repo/editor test && pnpm --filter @repo/editor exec tsc --noEmit`
Expected: PASS / 0 errors

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/extensions/resizable-image.tsx
git commit -m "feat(editor): просмотр изображения — клик (read-only), dblclick и кнопка тулбара"
```

---

### Task 4: fileAttachment — клик по карточке

**Files:**
- Modify: `packages/editor/src/extensions/file-attachment.tsx`

- [ ] **Step 1: Wire the card click**

1. В сигнатуре `FileAttachmentView` (строка 30) добавить `extension`:

```ts
function FileAttachmentView({ node, editor, selected, getPos, extension }: NodeViewProps) {
```

2. После `const showableAsImage = …` (строка 35) добавить:

```ts
  const onOpenFilePreview = (extension.options as FileAttachmentOptions).onOpenFilePreview
```

3. Импорт хелпера (строка 12, к существующему import из `./media-mime` НЕ добавлять — отдельная строка):

```ts
import { attachmentPreviewPayload } from './file-preview-interaction'
```

4. Карточке (внутренний `<Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, … }}>` на строке 109) добавить onClick и курсор:

```tsx
        <Box
          onClick={
            onOpenFilePreview ? () => onOpenFilePreview(attachmentPreviewPayload(attrs)) : undefined
          }
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            cursor: onOpenFilePreview ? 'pointer' : undefined,
            // …остальной sx без изменений…
```

Иконка скачивания уже делает `stopPropagation` на click/mouseDown (строки 164-165) — клик по ней НЕ откроет просмотр. Кнопки свопа в Paper-тулбаре — siblings карточки, их клики не всплывают в неё.

- [ ] **Step 2: Run editor tests + types**

Run: `pnpm --filter @repo/editor test && pnpm --filter @repo/editor exec tsc --noEmit`
Expected: PASS / 0 errors

- [ ] **Step 3: Commit**

```bash
git add packages/editor/src/extensions/file-attachment.tsx
git commit -m "feat(editor): клик по карточке вложения открывает просмотр"
```

---

### Task 5: video/audio — кнопка «Открыть просмотр»

**Files:**
- Modify: `packages/editor/src/extensions/video.tsx`
- Modify: `packages/editor/src/extensions/audio.tsx`

- [ ] **Step 1: video — hover-кнопка поверх плеера**

1. Импорты (video.tsx, к блоку иконок):

```ts
import OpenInFullIcon from '@mui/icons-material/OpenInFull'

import { mediaPreviewPayload } from './file-preview-interaction'
```

2. После `const uploadHandler = options.uploadHandler` (строка 41):

```ts
  const onOpenFilePreview = options.onOpenFilePreview

  const openPreview = () => {
    if (!onOpenFilePreview || !safeUrl) return
    onOpenFilePreview(
      mediaPreviewPayload({
        url: safeUrl,
        name,
        size: (node.attrs.size as number) || 0,
        mimeType: (node.attrs.mimeType as string) || '',
      }),
    )
  }
```

3. Внутри `<Box sx={{ position: 'relative', lineHeight: 0 }}>` ПОСЛЕ элемента `<Box component="video" …/>` (после строки 307, рядом с ресайз-ручками) добавить:

```tsx
            {onOpenFilePreview ? (
              <Tooltip title="Открыть просмотр" arrow>
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    openPreview()
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  data-testid="video-open-preview"
                  sx={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    bgcolor: 'background.paper',
                    boxShadow: 1,
                    opacity: 0,
                    transition: 'opacity .15s',
                    '.anynote-video-wrapper:hover &': { opacity: 1 },
                    '&:focus-visible': { opacity: 1 },
                    '&:hover': { bgcolor: 'background.paper' },
                  }}
                >
                  <OpenInFullIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
```

- [ ] **Step 2: audio — постоянная кнопка справа от плеера**

В audio.tsx (нативные контролы занимают всю ширину — hover-оверлей их перекрыл бы):

1. Импорты — те же, что в Step 1:

```ts
import OpenInFullIcon from '@mui/icons-material/OpenInFull'

import { mediaPreviewPayload } from './file-preview-interaction'
```

2. В `AudioView` после чтения опций (`const uploadHandler = options.uploadHandler`):

```ts
  const onOpenFilePreview = options.onOpenFilePreview

  const openPreview = () => {
    if (!onOpenFilePreview || !safeUrl) return
    onOpenFilePreview(
      mediaPreviewPayload({
        url: safeUrl,
        name,
        size: (node.attrs.size as number) || 0,
        mimeType: (node.attrs.mimeType as string) || '',
      }),
    )
  }
```

3. Заменить `<Box component="audio" …/>` (строки 234-240) на flex-строку:

```tsx
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box
            component="audio"
            src={safeUrl}
            controls
            preload="metadata"
            sx={{ display: 'block', width: '100%', flex: 1, minWidth: 0 }}
          />
          {onOpenFilePreview ? (
            <Tooltip title="Открыть просмотр" arrow>
              <IconButton
                size="small"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  openPreview()
                }}
                onMouseDown={(e) => e.stopPropagation()}
                data-testid="audio-open-preview"
                sx={{ color: 'text.secondary' }}
              >
                <OpenInFullIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : null}
        </Box>
```

- [ ] **Step 3: Run editor tests + types**

Run: `pnpm --filter @repo/editor test && pnpm --filter @repo/editor exec tsc --noEmit`
Expected: PASS / 0 errors

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/extensions/video.tsx packages/editor/src/extensions/audio.tsx
git commit -m "feat(editor): кнопка «Открыть просмотр» у видео и аудио"
```

---

### Task 6: drawio + mermaid/plantuml превью → новый просмотрщик

**Files:**
- Modify: `packages/editor/src/extensions/drawio.tsx`
- Modify: `packages/editor/src/extensions/code-block.tsx`

- [ ] **Step 1: drawio — read-only клик уходит в коллбек, диалог остаётся фолбеком**

В `DrawioView` (drawio.tsx):

1. После `const drawioUrl = …` (строка 20):

```ts
  const onOpenFilePreview = (extension.options as DrawioOptions).onOpenFilePreview
```

2. Заменить `handleClick` (строки 31-37) на маршрутизацию через общий хелпер:

```ts
  const openTarget = (target: 'viewer' | 'editor') => {
    // The app-level viewer replaces the legacy fullscreen dialog when wired;
    // without the callback (template editor, public pages) the dialog stays.
    if (target === 'viewer' && onOpenFilePreview) {
      if (attrs.svg) onOpenFilePreview({ kind: 'diagram', svg: attrs.svg, title: 'Диаграмма draw.io' })
      return
    }
    setView(target)
  }

  const handleClick = () => {
    if (clickTimer.current) clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(
      () => openTarget(getDrawioClickTarget({ isEditable: editor.isEditable })),
      250,
    )
  }
```

`handleDoubleClick` и `DrawioViewerDialog` НЕ трогать (двойной клик — редактор; диалог — фолбек). `drawio-interaction.ts` и его тест не меняются.

- [ ] **Step 2: code-block — клик по отрендеренному превью**

В `CodeBlockView` (code-block.tsx):

1. После `const showPreview = …` (строка 125):

```ts
  const onOpenFilePreview = extension.options.onOpenFilePreview ?? null
```

2. Заменить внутренний Box превью (строки 211-214) на:

```tsx
            <Box
              onClick={
                svg && onOpenFilePreview
                  ? () =>
                      onOpenFilePreview({
                        kind: 'diagram',
                        svg,
                        title: isPlantuml ? 'PlantUML' : 'Mermaid',
                      })
                  : undefined
              }
              sx={{
                width: '100%',
                display: 'flex',
                justifyContent: 'center',
                cursor: svg && onOpenFilePreview ? 'zoom-in' : undefined,
              }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
```

`svg` здесь уже прошёл `sanitizeSvg` (строка 139) — payload несёт санитизированную разметку.

- [ ] **Step 3: Run editor tests + types**

Run: `pnpm --filter @repo/editor test && pnpm --filter @repo/editor exec tsc --noEmit`
Expected: PASS (в т.ч. существующие `drawio-interaction.test.ts`, `code-block.test.ts`) / 0 errors

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/extensions/drawio.tsx packages/editor/src/extensions/code-block.tsx
git commit -m "feat(editor): клик по drawio и diagram-превью открывает общий просмотрщик"
```

---

### Task 7: Иконки в `@repo/ui` + контекст просмотра

**Files:**
- Modify: `packages/ui/src/components/index.ts`
- Create: `apps/web/src/components/page/file-preview/file-preview-context.tsx`
- Test: `apps/web/test/file-preview-context.test.ts`

- [ ] **Step 1: Экспорты иконок и useMediaQuery в `@repo/ui`**

В `packages/ui/src/components/index.ts`:

- Рядом с `export { default as OpenInFullIcon } …` (строка 169) добавить:

```ts
export { default as CloseFullscreenIcon } from '@mui/icons-material/CloseFullscreen'
export { default as FitScreenIcon } from '@mui/icons-material/FitScreen'
export { default as ZoomInIcon } from '@mui/icons-material/ZoomIn'
export { default as ZoomOutIcon } from '@mui/icons-material/ZoomOut'
```

- Рядом с `export { useTheme } from '@mui/material/styles'` (строка 13) добавить:

```ts
export { default as useMediaQuery } from '@mui/material/useMediaQuery'
```

- [ ] **Step 2: Write the failing context test (pure helpers, node env)**

Web-тесты — node env, поэтому тестируем чистые функции, экспортируемые из файла контекста (паттерн `comments-context.test.tsx`):

```ts
// apps/web/test/file-preview-context.test.ts
import { describe, expect, it } from 'vitest'

import {
  FILE_PREVIEW_MIN_WIDTH,
  clampPreviewWidth,
  defaultPreviewWidth,
  resolveOpenAction,
} from '@/components/page/file-preview/file-preview-context'

describe('clampPreviewWidth', () => {
  it('не уже минимума и не шире 70% вьюпорта', () => {
    expect(clampPreviewWidth(100, 1600)).toBe(FILE_PREVIEW_MIN_WIDTH)
    expect(clampPreviewWidth(2000, 1600)).toBe(1120)
    expect(clampPreviewWidth(700, 1600)).toBe(700)
  })

  it('на узком вьюпорте минимум побеждает 70%', () => {
    expect(clampPreviewWidth(500, 400)).toBe(FILE_PREVIEW_MIN_WIDTH)
  })
})

describe('defaultPreviewWidth', () => {
  it('половина вьюпорта в пределах клампа (спека: «на половину»)', () => {
    expect(defaultPreviewWidth(1600)).toBe(800)
    expect(defaultPreviewWidth(600)).toBe(FILE_PREVIEW_MIN_WIDTH)
  })
})

describe('resolveOpenAction', () => {
  it('диаграммы всегда открываются в панели', () => {
    expect(resolveOpenAction({ kind: 'diagram', svg: '<svg/>' })).toBe('panel')
  })

  it('просматриваемый файл → panel, неизвестный тип → download', () => {
    expect(
      resolveOpenAction({
        kind: 'file',
        url: '/api/files/x',
        name: 'a.pdf',
        mimeType: 'application/pdf',
        size: 1,
      }),
    ).toBe('panel')
    expect(
      resolveOpenAction({
        kind: 'file',
        url: '/api/files/x',
        name: 'a.zip',
        mimeType: 'application/zip',
        size: 1,
      }),
    ).toBe('download')
  })

  it('ext-фолбэк из имени спасает octet-stream', () => {
    expect(
      resolveOpenAction({
        kind: 'file',
        url: '/api/files/x',
        name: 'Отчёт.docx',
        mimeType: 'application/octet-stream',
        size: 1,
      }),
    ).toBe('panel')
  })
})
```

Run: `pnpm --filter web exec vitest run test/file-preview-context.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the context**

```tsx
// apps/web/src/components/page/file-preview/file-preview-context.tsx
'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import type { FilePreviewPayload } from '@repo/editor'
import { useMediaQuery, useTheme } from '@repo/ui/components'

import { extFromFileName, resolvePreviewType } from '@/lib/preview-kind'

export const FILE_PREVIEW_MIN_WIDTH = 360

/** split — правая докованная колонка; full — Dialog fullScreen. */
export type FilePreviewMode = 'split' | 'full'

const MODE_KEY = 'filePreview.displayMode'
const WIDTH_KEY = 'filePreview.sidebar.width'

// --- Pure helpers (unit-tested in test/file-preview-context.test.ts) --------

export const clampPreviewWidth = (value: number, viewportWidth: number): number => {
  const max = Math.max(FILE_PREVIEW_MIN_WIDTH, Math.round(viewportWidth * 0.7))
  return Math.min(max, Math.max(FILE_PREVIEW_MIN_WIDTH, value))
}

/** Спека §4: при первом открытии панель занимает половину вьюпорта. */
export const defaultPreviewWidth = (viewportWidth: number): number =>
  clampPreviewWidth(Math.round(viewportWidth / 2), viewportWidth)

export type FilePreviewOpenAction = 'panel' | 'download'

/** null-тип из resolvePreviewType = не просматриваемый → скачивание (спека §3). */
export const resolveOpenAction = (payload: FilePreviewPayload): FilePreviewOpenAction => {
  if (payload.kind === 'diagram') return 'panel'
  return resolvePreviewType(payload.mimeType, extFromFileName(payload.name)) ? 'panel' : 'download'
}

const triggerDownload = (url: string, name: string | null) => {
  const a = document.createElement('a')
  a.href = url
  a.download = name ?? ''
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

// --- Context -----------------------------------------------------------------

type FilePreviewContextValue = {
  payload: FilePreviewPayload | null
  open: (payload: FilePreviewPayload) => void
  close: () => void
  mode: FilePreviewMode
  setMode: (mode: FilePreviewMode) => void
  /** 'full' принудительно на < md — сплит там не помещается (спека §4). */
  effectiveMode: FilePreviewMode
  isMobile: boolean
  sidebarWidth: number
  commitSidebarWidth: (width: number) => void
}

const FilePreviewContext = createContext<FilePreviewContextValue | null>(null)

/** Non-throwing — page-renderer/FAB рендерятся и там, где провайдера нет
 *  (PageView/template editor) и должны деградировать к текущему поведению. */
export function useFilePreview(): FilePreviewContextValue | null {
  return useContext(FilePreviewContext)
}

export function FilePreviewProvider({
  pageId,
  children,
}: {
  pageId: string
  children: ReactNode
}) {
  const [payload, setPayload] = useState<FilePreviewPayload | null>(null)

  // Режим переживает навигацию и перезагрузки (паттерн pageChat.displayMode):
  // дефолт split, гидратация из localStorage после маунта.
  const [mode, setModeState] = useState<FilePreviewMode>('split')
  useEffect(() => {
    const stored = window.localStorage.getItem(MODE_KEY)
    if (stored === 'split' || stored === 'full') setModeState(stored)
  }, [])
  const setMode = useCallback((next: FilePreviewMode) => {
    setModeState(next)
    window.localStorage.setItem(MODE_KEY, next)
  }, [])

  // Ширина: дефолт — половина вьюпорта при гидратации, персист по коммиту.
  const [sidebarWidth, setSidebarWidthState] = useState(FILE_PREVIEW_MIN_WIDTH)
  useEffect(() => {
    const stored = Number.parseInt(window.localStorage.getItem(WIDTH_KEY) ?? '', 10)
    setSidebarWidthState(
      Number.isNaN(stored)
        ? defaultPreviewWidth(window.innerWidth)
        : clampPreviewWidth(stored, window.innerWidth),
    )
  }, [])
  const commitSidebarWidth = useCallback((width: number) => {
    const clamped = clampPreviewWidth(width, window.innerWidth)
    setSidebarWidthState(clamped)
    window.localStorage.setItem(WIDTH_KEY, String(clamped))
  }, [])

  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const effectiveMode: FilePreviewMode = isMobile ? 'full' : mode

  const open = useCallback((next: FilePreviewPayload) => {
    if (resolveOpenAction(next) === 'download') {
      if (next.kind === 'file') triggerDownload(next.url, next.name)
      return
    }
    setPayload(next)
  }, [])
  const close = useCallback(() => setPayload(null), [])

  // Сброс при смене страницы без перемонтирования провайдера (паттерн
  // prevPageId из page-chat-context).
  const [prevPageId, setPrevPageId] = useState(pageId)
  if (pageId !== prevPageId) {
    setPrevPageId(pageId)
    setPayload(null)
  }

  const value = useMemo(
    () => ({
      payload,
      open,
      close,
      mode,
      setMode,
      effectiveMode,
      isMobile,
      sidebarWidth,
      commitSidebarWidth,
    }),
    [payload, open, close, mode, setMode, effectiveMode, isMobile, sidebarWidth, commitSidebarWidth],
  )

  return <FilePreviewContext.Provider value={value}>{children}</FilePreviewContext.Provider>
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run test/file-preview-context.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/index.ts \
  apps/web/src/components/page/file-preview/file-preview-context.tsx \
  apps/web/test/file-preview-context.test.ts
git commit -m "feat(web): контекст просмотра файлов + иконки фуллскрина/зума в @repo/ui"
```

---

### Task 8: ZoomPanViewport + просмотрщики по типам + FilePreviewContent

**Files:**
- Create: `apps/web/src/components/page/file-preview/zoom-pan-viewport.tsx`
- Create: `apps/web/src/components/page/file-preview/viewers.tsx`
- Create: `apps/web/src/components/page/file-preview/file-preview-content.tsx`

Компонентные юниты тут не пишем (node env) — поведение покрывает E2E (Task 14); чистая логика уже покрыта Task 1/7.

- [ ] **Step 1: `zoom-pan-viewport.tsx`**

```tsx
// apps/web/src/components/page/file-preview/zoom-pan-viewport.tsx
'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import {
  Box,
  FitScreenIcon,
  IconButton,
  Paper,
  Tooltip,
  ZoomInIcon,
  ZoomOutIcon,
} from '@repo/ui/components'

const MIN_SCALE = 0.2
const MAX_SCALE = 8

type Transform = { scale: number; tx: number; ty: number }
const IDENTITY: Transform = { scale: 1, tx: 0, ty: 0 }

type Props = {
  children: ReactNode
  /** Масштаб «100%» (naturalWidth / отображаемая ширина при fit). Null пока
   *  неизвестен (картинка не загрузилась) — кнопка 1:1 скрыта. */
  getNaturalScale?: () => number | null
}

/** Зум колесом (к курсору), пан драгом, кнопки −/+/вписать/1:1, dblclick —
 *  toggle вписать↔увеличить. Identity-масштаб = «вписать»: контент внутри
 *  центрирован и ограничен maxWidth/maxHeight 100%. */
export function ZoomPanViewport({ children, getNaturalScale }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [t, setT] = useState<Transform>(IDENTITY)
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)

  const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    setT((prev) => {
      const rect = containerRef.current?.getBoundingClientRect()
      const px = cx ?? (rect ? rect.width / 2 : 0)
      const py = cy ?? (rect ? rect.height / 2 : 0)
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * factor))
      const k = scale / prev.scale
      return { scale, tx: px - k * (px - prev.tx), ty: py - k * (py - prev.ty) }
    })
  }, [])

  // Колесо должно гасить прокрутку страницы; React onWheel — passive, поэтому
  // вешаем нативный слушатель.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      zoomAt(Math.exp(-e.deltaY * 0.002), e.clientX - rect.left, e.clientY - rect.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  const naturalScale = () => {
    const natural = getNaturalScale?.()
    if (!natural || !Number.isFinite(natural)) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const scale = clampScale(natural)
    // Держим центр контейнера на месте: origin '0 0' + центрированный контент —
    // {scale, 0, 0} унёс бы центр в (n·W/2, n·H/2), при n>2 контент за экраном.
    setT({ scale, tx: ((1 - scale) * rect.width) / 2, ty: ((1 - scale) * rect.height) / 2 })
  }

  const isIdentity = t.scale === 1 && t.tx === 0 && t.ty === 0

  return (
    <Box
      ref={containerRef}
      data-testid="zoom-pan-viewport"
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('[data-zoom-toolbar]')) return
        dragRef.current = { x: e.clientX, y: e.clientY, tx: t.tx, ty: t.ty }
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          // synthetic events without an active pointer — drag still works
        }
      }}
      onPointerMove={(e) => {
        const drag = dragRef.current
        if (!drag) return
        setT((prev) => ({
          ...prev,
          tx: drag.tx + (e.clientX - drag.x),
          ty: drag.ty + (e.clientY - drag.y),
        }))
      }}
      onPointerUp={(e) => {
        dragRef.current = null
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId)
        }
      }}
      onPointerCancel={() => {
        dragRef.current = null
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('[data-zoom-toolbar]')) return
        if (isIdentity) {
          const rect = containerRef.current?.getBoundingClientRect()
          zoomAt(2, rect ? e.clientX - rect.left : undefined, rect ? e.clientY - rect.top : undefined)
        } else {
          setT(IDENTITY)
        }
      }}
      sx={{
        position: 'relative',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        cursor: 'grab',
        touchAction: 'none',
        '&:active': { cursor: 'grabbing' },
      }}
    >
      <Box
        sx={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `translate(${t.tx}px, ${t.ty}px) scale(${t.scale})`,
          transformOrigin: '0 0',
        }}
      >
        {children}
      </Box>
      <Paper
        data-zoom-toolbar
        elevation={3}
        sx={{
          position: 'absolute',
          bottom: 12,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 0.25,
          px: 0.5,
          py: 0.25,
          borderRadius: 2,
        }}
      >
        <Tooltip title="Уменьшить">
          <IconButton size="small" onClick={() => zoomAt(1 / 1.25)}>
            <ZoomOutIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Увеличить">
          <IconButton size="small" onClick={() => zoomAt(1.25)}>
            <ZoomInIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Вписать">
          <IconButton size="small" onClick={() => setT(IDENTITY)}>
            <FitScreenIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        {getNaturalScale ? (
          <Tooltip title="100%">
            <IconButton
              size="small"
              onClick={naturalScale}
              sx={{ fontSize: 11, fontWeight: 700, width: 32, borderRadius: 1 }}
            >
              1:1
            </IconButton>
          </Tooltip>
        ) : null}
      </Paper>
    </Box>
  )
}
```

- [ ] **Step 2: `viewers.tsx` — просмотрщики по типам**

```tsx
// apps/web/src/components/page/file-preview/viewers.tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  Box,
  Button,
  CircularProgress,
  DownloadIcon,
  InsertDriveFileOutlinedIcon,
  Typography,
} from '@repo/ui/components'

import { TEXT_PREVIEW_MAX_BYTES, extractApiFileId } from '@/lib/preview-kind'

import { ZoomPanViewport } from './zoom-pan-viewport'

const Center = ({ children }: { children: React.ReactNode }) => (
  <Box
    sx={{
      flex: 1,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 1.5,
      p: 3,
      textAlign: 'center',
    }}
  >
    {children}
  </Box>
)

export function DownloadPrompt({
  url,
  name,
  reason,
}: {
  url: string
  name: string | null
  reason: string
}) {
  return (
    <Center>
      <InsertDriveFileOutlinedIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
      {name ? <Typography variant="body2">{name}</Typography> : null}
      <Typography variant="caption" color="text.secondary">
        {reason}
      </Typography>
      <Button
        component="a"
        href={url}
        download={name ?? ''}
        target="_blank"
        rel="noopener noreferrer"
        startIcon={<DownloadIcon />}
        size="small"
      >
        Скачать
      </Button>
    </Center>
  )
}

export function ImageViewer({ url, name }: { url: string; name: string | null }) {
  const imgRef = useRef<HTMLImageElement | null>(null)
  const getNaturalScale = useCallback(() => {
    const img = imgRef.current
    if (!img || !img.naturalWidth || !img.clientWidth) return null
    return img.naturalWidth / img.clientWidth
  }, [])
  return (
    <ZoomPanViewport getNaturalScale={getNaturalScale}>
      <Box
        component="img"
        ref={imgRef}
        src={url}
        alt={name ?? ''}
        draggable={false}
        sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', userSelect: 'none' }}
      />
    </ZoomPanViewport>
  )
}

export type SvgSource = { kind: 'url'; value: string } | { kind: 'inline'; value: string }

/** SVG показываем ТОЛЬКО через <img> (скрипты внутри не выполняются) — серверный
 *  запрет inline-SVG (file-validation isInlineSafeMime) не трогаем. Разметка и
 *  файл заворачиваются в Blob-URL; data:-URI (drawio) идёт в src напрямую. */
export function SvgViewer({ source, name }: { source: SvgSource; name?: string | null }) {
  const [src, setSrc] = useState<string | null>(
    source.kind === 'inline' && source.value.startsWith('data:') ? source.value : null,
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    const assign = (markup: string) => {
      objectUrl = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
      if (!cancelled) setSrc(objectUrl)
    }
    if (source.kind === 'inline') {
      if (source.value.startsWith('data:')) setSrc(source.value)
      else assign(source.value)
    } else {
      setSrc(null)
      fetch(source.value, { credentials: 'include' })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return res.text()
        })
        .then((text) => assign(text))
        .catch(() => {
          if (!cancelled) setError('Не удалось загрузить файл')
        })
    }
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [source.kind, source.value])

  if (error) {
    return (
      <Center>
        <Typography variant="body2" color="text.secondary">
          {error}
        </Typography>
      </Center>
    )
  }
  if (!src) {
    return (
      <Center>
        <CircularProgress size={24} />
      </Center>
    )
  }
  return <ImageViewer url={src} name={name ?? null} />
}

export function PdfViewer({ url, name }: { url: string; name: string | null }) {
  return (
    <Box
      component="iframe"
      src={url}
      title={name ?? 'PDF'}
      data-testid="file-preview-pdf-frame"
      sx={{ border: 0, width: '100%', flex: 1, minHeight: 0 }}
    />
  )
}

export function OfficeViewer({ url, name }: { url: string; name: string | null }) {
  const fileId = extractApiFileId(url)
  if (!fileId) {
    return <DownloadPrompt url={url} name={name} reason="Предпросмотр недоступен для этого файла" />
  }
  // Конвертация может занять секунды — iframe сам показывает результат/ошибку
  // роута; таймаут Gotenberg отдаёт текст с 504/502.
  return (
    <Box
      component="iframe"
      src={`/api/files/${fileId}/preview-pdf`}
      title={name ?? 'Документ'}
      data-testid="file-preview-office-frame"
      sx={{ border: 0, width: '100%', flex: 1, minHeight: 0 }}
    />
  )
}

export function MediaViewer({
  url,
  name,
  media,
}: {
  url: string
  name: string | null
  media: 'video' | 'audio'
}) {
  return (
    <Center>
      {media === 'video' ? (
        <Box
          component="video"
          src={url}
          controls
          preload="metadata"
          sx={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 1, backgroundColor: 'black' }}
        />
      ) : (
        <Box component="audio" src={url} controls preload="metadata" sx={{ width: '100%' }} />
      )}
      {name ? (
        <Typography variant="caption" color="text.secondary">
          {name}
        </Typography>
      ) : null}
    </Center>
  )
}

export function TextViewer({
  url,
  name,
  size,
}: {
  url: string
  name: string | null
  size: number | null
}) {
  const tooBig = size != null && size > TEXT_PREVIEW_MAX_BYTES
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (tooBig) return
    let cancelled = false
    fetch(url, { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.text()
      })
      .then((body) => {
        if (!cancelled) setText(body)
      })
      .catch(() => {
        if (!cancelled) setError('Не удалось загрузить файл')
      })
    return () => {
      cancelled = true
    }
  }, [url, tooBig])

  if (tooBig) {
    return <DownloadPrompt url={url} name={name} reason="Файл больше 1 МБ — скачайте для просмотра" />
  }
  if (error) {
    return <DownloadPrompt url={url} name={name} reason={error} />
  }
  if (text === null) {
    return (
      <Center>
        <CircularProgress size={24} />
      </Center>
    )
  }
  return (
    <Box
      component="pre"
      data-testid="file-preview-text"
      sx={{
        m: 0,
        p: 2,
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        fontFamily: 'monospace',
        fontSize: 13,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {text}
    </Box>
  )
}
```

Проверь, что `InsertDriveFileOutlinedIcon` экспортирован из `@repo/ui/components` (`grep InsertDriveFileOutlined packages/ui/src/components/index.ts`); если нет — добавить экспорт рядом с другими иконками:

```ts
export { default as InsertDriveFileOutlinedIcon } from '@mui/icons-material/InsertDriveFileOutlined'
```

- [ ] **Step 3: `file-preview-content.tsx` — свитч по типу**

```tsx
// apps/web/src/components/page/file-preview/file-preview-content.tsx
'use client'

import type { FilePreviewPayload } from '@repo/editor'

import { extFromFileName, resolvePreviewType } from '@/lib/preview-kind'

import {
  DownloadPrompt,
  ImageViewer,
  MediaViewer,
  OfficeViewer,
  PdfViewer,
  SvgViewer,
  TextViewer,
} from './viewers'

/** Общий контент сплит-панели и фуллскрин-диалога (спека §5). */
export function FilePreviewContent({ payload }: { payload: FilePreviewPayload }) {
  if (payload.kind === 'diagram') {
    return <SvgViewer source={{ kind: 'inline', value: payload.svg }} name={payload.title} />
  }
  const type = resolvePreviewType(payload.mimeType, extFromFileName(payload.name))
  switch (type) {
    case 'image':
      return <ImageViewer url={payload.url} name={payload.name} />
    case 'svg':
      return <SvgViewer source={{ kind: 'url', value: payload.url }} name={payload.name} />
    case 'pdf':
      return <PdfViewer url={payload.url} name={payload.name} />
    case 'office':
      return <OfficeViewer url={payload.url} name={payload.name} />
    case 'video':
    case 'audio':
      return <MediaViewer url={payload.url} name={payload.name} media={type} />
    case 'text':
      return <TextViewer url={payload.url} name={payload.name} size={payload.size} />
    default:
      // open() гейтит null-типы в download, сюда попадать не должны — но
      // рендерим честный фолбэк на случай прямого вызова.
      return (
        <DownloadPrompt
          url={payload.url}
          name={payload.name}
          reason="Предпросмотр не поддерживается"
        />
      )
  }
}
```

- [ ] **Step 4: Type-check web**

Run: `pnpm --filter web check-types`
Expected: 0 errors (памятка: если TS2307 на удалённый роут — `rm -rf apps/web/.next/types`)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/page/file-preview/zoom-pan-viewport.tsx \
  apps/web/src/components/page/file-preview/viewers.tsx \
  apps/web/src/components/page/file-preview/file-preview-content.tsx \
  packages/ui/src/components/index.ts
git commit -m "feat(web): просмотрщики по типам + zoom/pan вьюпорт"
```

---

### Task 9: Сплит-панель, фуллскрин-диалог, общая шапка

**Files:**
- Create: `apps/web/src/components/page/file-preview/file-preview-header.tsx`
- Create: `apps/web/src/components/page/file-preview/file-preview-sidebar.tsx`
- Create: `apps/web/src/components/page/file-preview/file-preview-dialog.tsx`
- Modify: `apps/web/src/components/page/file-preview/file-preview-content.tsx` — добавить экспорт
  ключа идентичности файла (используется обоими маунт-сайтами ниже):

```ts
/** Смена файла обязана пересоздавать просмотрщик (см. key в сайдбаре/диалоге). */
export const previewContentKey = (payload: FilePreviewPayload): string =>
  payload.kind === 'file' ? payload.url : payload.svg
```

- [ ] **Step 1: `file-preview-header.tsx`**

```tsx
// apps/web/src/components/page/file-preview/file-preview-header.tsx
'use client'

import type { FilePreviewPayload } from '@repo/editor'
import {
  Box,
  CloseFullscreenIcon,
  CloseIcon,
  DownloadIcon,
  IconButton,
  OpenInFullIcon,
  Tooltip,
  Typography,
} from '@repo/ui/components'

import { useFilePreview } from './file-preview-context'

const downloadPayload = (payload: FilePreviewPayload) => {
  const a = document.createElement('a')
  let objectUrl: string | null = null
  if (payload.kind === 'file') {
    a.href = payload.url
    a.download = payload.name ?? ''
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
  } else if (payload.svg.startsWith('data:')) {
    a.href = payload.svg
    a.download = `${payload.title ?? 'diagram'}.svg`
  } else {
    objectUrl = URL.createObjectURL(new Blob([payload.svg], { type: 'image/svg+xml' }))
    a.href = objectUrl
    a.download = `${payload.title ?? 'diagram'}.svg`
  }
  document.body.appendChild(a)
  a.click()
  a.remove()
  if (objectUrl) URL.revokeObjectURL(objectUrl)
}

export function FilePreviewHeader({ payload }: { payload: FilePreviewPayload }) {
  const ctx = useFilePreview()
  if (!ctx) return null
  const title =
    payload.kind === 'file' ? (payload.name ?? 'Файл') : (payload.title ?? 'Диаграмма')
  const fullscreen = ctx.effectiveMode === 'full'

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1.5,
        py: 1,
        borderBottom: 1,
        borderColor: 'divider',
        flexShrink: 0,
      }}
    >
      <Typography
        variant="subtitle2"
        sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {title}
      </Typography>
      <Tooltip title="Скачать">
        <IconButton size="small" data-testid="file-preview-download" onClick={() => downloadPayload(payload)}>
          <DownloadIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      {ctx.isMobile ? null : fullscreen ? (
        <Tooltip title="Свернуть в панель">
          <IconButton size="small" data-testid="file-preview-collapse" onClick={() => ctx.setMode('split')}>
            <CloseFullscreenIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : (
        <Tooltip title="На весь экран">
          <IconButton size="small" data-testid="file-preview-expand" onClick={() => ctx.setMode('full')}>
            <OpenInFullIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      <Tooltip title="Закрыть">
        <IconButton size="small" data-testid="file-preview-close" onClick={ctx.close}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  )
}
```

- [ ] **Step 2: `file-preview-sidebar.tsx` (копия механики page-chat docked)**

```tsx
// apps/web/src/components/page/file-preview/file-preview-sidebar.tsx
'use client'

import { useEffect, useRef } from 'react'

import { Box, Collapse } from '@repo/ui/components'

import { PanelResizeHandle } from '@/components/workspace/panel-resize-handle'

import { FILE_PREVIEW_MIN_WIDTH, useFilePreview } from './file-preview-context'
import { FilePreviewContent } from './file-preview-content'
import { FilePreviewHeader } from './file-preview-header'

/** Докованная сплит-панель (спека §4): flex-сосед контента страницы, справа,
 *  как PageChatSidebar. Живой ресайз — императивно (style.width), коммит — в
 *  контекст + localStorage. */
export function FilePreviewSidebar() {
  const ctx = useFilePreview()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const shown = Boolean(ctx?.payload) && ctx?.effectiveMode === 'split'
  const close = ctx?.close

  // Esc в сплите закрывает просмотр (Esc фуллскрина обрабатывает Dialog).
  useEffect(() => {
    if (!shown || !close) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [shown, close])

  if (!ctx) return null
  const maxWidth =
    typeof window === 'undefined'
      ? 900
      : Math.max(FILE_PREVIEW_MIN_WIDTH, Math.round(window.innerWidth * 0.7))

  return (
    <Collapse
      in={shown}
      orientation="horizontal"
      unmountOnExit
      sx={{
        flexShrink: 0,
        height: '100%',
        position: 'relative',
        zIndex: 10,
        '& .MuiCollapse-wrapper, & .MuiCollapse-wrapperInner': { height: '100%' },
      }}
    >
      <Box
        ref={panelRef}
        data-testid="file-preview-sidebar"
        style={{ width: ctx.sidebarWidth }}
        sx={{
          bgcolor: 'background.default',
          borderLeft: 1,
          borderColor: 'divider',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          position: 'relative',
          contain: 'layout style',
        }}
      >
        {ctx.payload ? (
          <>
            <FilePreviewHeader payload={ctx.payload} />
            {/* key: смена файла ДОЛЖНА пересоздать просмотрщик — иначе залипают
                error/text-состояния и zoom/pan-трансформация прошлого файла. */}
            <FilePreviewContent key={previewContentKey(ctx.payload)} payload={ctx.payload} />
          </>
        ) : null}
        <PanelResizeHandle
          edge="left"
          width={ctx.sidebarWidth}
          min={FILE_PREVIEW_MIN_WIDTH}
          max={maxWidth}
          onWidth={(next) => {
            panelRef.current?.style.setProperty('width', `${next}px`)
          }}
          onCommit={ctx.commitSidebarWidth}
          ariaLabel="Изменить ширину просмотра"
          testId="file-preview-sidebar-resize"
        />
      </Box>
    </Collapse>
  )
}
```

- [ ] **Step 3: `file-preview-dialog.tsx`**

```tsx
// apps/web/src/components/page/file-preview/file-preview-dialog.tsx
'use client'

import { Box, Dialog } from '@repo/ui/components'

import { useFilePreview } from './file-preview-context'
import { FilePreviewContent } from './file-preview-content'
import { FilePreviewHeader } from './file-preview-header'

/** Полноэкранный режим (спека §4). Esc/backdrop: на десктопе возвращает в
 *  сплит, на мобильном (сплит недоступен) закрывает просмотр. */
export function FilePreviewDialog() {
  const ctx = useFilePreview()
  if (!ctx) return null
  const open = Boolean(ctx.payload) && ctx.effectiveMode === 'full'
  const handleClose = () => {
    if (ctx.isMobile) ctx.close()
    else ctx.setMode('split')
  }

  return (
    <Dialog open={open} onClose={handleClose} fullScreen>
      {ctx.payload ? (
        <Box
          data-testid="file-preview-dialog"
          sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}
        >
          <FilePreviewHeader payload={ctx.payload} />
          {/* key — как в сайдбаре: смена файла пересоздаёт просмотрщик. */}
          <FilePreviewContent key={previewContentKey(ctx.payload)} payload={ctx.payload} />
        </Box>
      ) : null}
    </Dialog>
  )
}
```

Проверь экспорт `Dialog` из `@repo/ui/components` (используется в workspace-settings-dialog — есть).

- [ ] **Step 4: Type-check + lint**

Run: `pnpm --filter web check-types && pnpm --filter web lint`
Expected: 0 errors / 0 warnings

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/page/file-preview/
git commit -m "feat(web): сплит-панель и фуллскрин-диалог просмотра файлов"
```

---

### Task 10: Монтирование — layout, page-renderer, оффсеты

**Files:**
- Modify: `apps/web/src/components/workspace/workspace-layout-client.tsx:292-296,302-320`
- Modify: `apps/web/src/components/page/page-renderer.tsx` (пропсы редактора ~727, EditorOutline ~762-773)
- Modify: `apps/web/src/components/page/page-chat/page-chat-fab.tsx:22-30`

- [ ] **Step 1: Mount provider + panels in `workspace-layout-client.tsx`**

1. Импорты:

```ts
import { FilePreviewProvider } from '@/components/page/file-preview/file-preview-context'
import { FilePreviewSidebar } from '@/components/page/file-preview/file-preview-sidebar'
import { FilePreviewDialog } from '@/components/page/file-preview/file-preview-dialog'
```

2. В `mainContent` flex-row (строки 292-295) после `PageChatSidebar` добавить:

```tsx
      {activePageId ? <FilePreviewSidebar /> : null}
      {activePageId ? <FilePreviewDialog /> : null}
      {activePageId ? <PageChatFab /> : null}
```

(`PageChatFab` остаётся последним; `FilePreviewDialog` рендерится в портале — место в JSX некритично, но держим рядом с панелью.)

3. В `pageMain` (строки 302-320) обернуть `PageEditorProvider`:

```tsx
        <PageChatProvider pageId={activePageId ?? ''} pageType={activePageType}>
          <FilePreviewProvider pageId={activePageId ?? ''}>
            <PageEditorProvider>{mainContent}</PageEditorProvider>
          </FilePreviewProvider>
        </PageChatProvider>
```

- [ ] **Step 2: Wire the editor prop + outline offset in `page-renderer.tsx`**

1. Импорт:

```ts
import { useFilePreview } from '@/components/page/file-preview/file-preview-context'
```

2. Рядом с получением `pageChat`-контекста в компоненте (найди `usePageChatContext()` в теле `PageRenderer`) добавить:

```ts
  const filePreview = useFilePreview()
```

3. В пропсы `AnyNoteEditor` (после `generateAI={…}`, строка 728):

```tsx
          onOpenFilePreview={filePreview ? filePreview.open : undefined}
```

4. `EditorOutline rightOffset` (строки 762-773) — добавить слагаемое:

```tsx
          rightOffset={
            (panelOpen ? COMMENTS_SIDEBAR_WIDTH : 0) +
            (pageChat?.panelOpen && pageChat.displayMode === 'docked'
              ? pageChat.sidebarWidth
              : 0) +
            // Докованная панель просмотра резервирует layout-ширину так же,
            // как докованный чат.
            (filePreview?.payload && filePreview.effectiveMode === 'split'
              ? filePreview.sidebarWidth
              : 0)
          }
```

- [ ] **Step 3: FAB offset in `page-chat-fab.tsx`**

```ts
import { useFilePreview } from '@/components/page/file-preview/file-preview-context'
```

В теле компонента:

```ts
  const preview = useFilePreview()
  const previewOffset =
    preview?.payload && preview.effectiveMode === 'split' ? preview.sidebarWidth : 0
  const rightOffset = (commentsOpen ? COMMENTS_SIDEBAR_WIDTH : 0) + previewOffset
```

(заменяет строку 22).

- [ ] **Step 4: Verify in the running app (RSC-правило CLAUDE.md: после prop-wiring курлим роут)**

```bash
docker compose up -d && pnpm --filter web dev &
sleep 30 && curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/sign-in
```

Expected: `200`. Затем вручную (или через playwright MCP): открыть страницу с картинкой, dblclick → панель справа, документ слева; `OpenInFullIcon` → фуллскрин; `CloseFullscreenIcon` → сплит; Esc → закрытие. Остановить dev-сервер после проверки.

- [ ] **Step 5: Run web tests + types**

Run: `pnpm --filter web test && pnpm --filter web check-types`
Expected: PASS / 0 errors

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/workspace/workspace-layout-client.tsx \
  apps/web/src/components/page/page-renderer.tsx \
  apps/web/src/components/page/page-chat/page-chat-fab.tsx
git commit -m "feat(web): монтирование просмотрщика — провайдер, панели, оффсеты outline/FAB"
```

---

### Task 11: `authorizeFileRead` — извлечение авторизации из файлового роута

**Files:**
- Create: `apps/web/src/lib/file-access.ts`
- Modify: `apps/web/src/app/api/files/[id]/route.ts:12-79`
- Test: `apps/web/test/file-access.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/test/file-access.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  fileFindUnique: vi.fn(),
  memberFindUnique: vi.fn(),
  blockedFindUnique: vi.fn(),
  pageFileFindFirst: vi.fn(),
}))

vi.mock('@/lib/get-session', () => ({ getSession: mocks.getSession }))
vi.mock('@repo/db', () => ({
  prisma: {
    file: { findUnique: mocks.fileFindUnique },
    workspaceMember: { findUnique: mocks.memberFindUnique },
    workspaceBlockedUser: { findUnique: mocks.blockedFindUnique },
    pageFile: { findFirst: mocks.pageFileFindFirst },
  },
}))

import { authorizeFileRead } from '../src/lib/file-access'

const baseFile = {
  id: 'f1',
  userId: 'owner',
  workspaceId: 'w1',
  status: 'ACTIVE',
  isPublic: false,
  expiresAt: null,
}

describe('authorizeFileRead', () => {
  beforeEach(() => vi.clearAllMocks())

  it('404 когда файла нет или он не ACTIVE', async () => {
    mocks.fileFindUnique.mockResolvedValue(null)
    let res = await authorizeFileRead('f1')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.status).toBe(404)

    mocks.fileFindUnique.mockResolvedValue({ ...baseFile, status: 'DELETED' })
    res = await authorizeFileRead('f1')
    if (!res.ok) expect(res.response.status).toBe(404)
  })

  it('410 после expiresAt', async () => {
    mocks.fileFindUnique.mockResolvedValue({ ...baseFile, expiresAt: new Date(Date.now() - 1000) })
    const res = await authorizeFileRead('f1')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.status).toBe(410)
  })

  it('публичный файл отдаётся без сессии', async () => {
    mocks.fileFindUnique.mockResolvedValue({ ...baseFile, isPublic: true })
    mocks.getSession.mockResolvedValue(null)
    const res = await authorizeFileRead('f1')
    expect(res.ok).toBe(true)
  })

  it('401 приватный без сессии', async () => {
    mocks.fileFindUnique.mockResolvedValue(baseFile)
    mocks.getSession.mockResolvedValue(null)
    const res = await authorizeFileRead('f1')
    if (!res.ok) expect(res.response.status).toBe(401)
  })

  it('владелец проходит без проверок членства', async () => {
    mocks.fileFindUnique.mockResolvedValue(baseFile)
    mocks.getSession.mockResolvedValue({ user: { id: 'owner' } })
    const res = await authorizeFileRead('f1')
    expect(res.ok).toBe(true)
    expect(mocks.memberFindUnique).not.toHaveBeenCalled()
  })

  it('незаблокированный участник workspace проходит', async () => {
    mocks.fileFindUnique.mockResolvedValue(baseFile)
    mocks.getSession.mockResolvedValue({ user: { id: 'member' } })
    mocks.memberFindUnique.mockResolvedValue({ userId: 'member' })
    mocks.blockedFindUnique.mockResolvedValue(null)
    const res = await authorizeFileRead('f1')
    expect(res.ok).toBe(true)
  })

  it('заблокированный участник без PageFile-связи получает 403', async () => {
    mocks.fileFindUnique.mockResolvedValue(baseFile)
    mocks.getSession.mockResolvedValue({ user: { id: 'blocked' } })
    mocks.memberFindUnique.mockResolvedValue({ userId: 'blocked' })
    mocks.blockedFindUnique.mockResolvedValue({ id: 'b1' })
    mocks.pageFileFindFirst.mockResolvedValue(null)
    const res = await authorizeFileRead('f1')
    if (!res.ok) expect(res.response.status).toBe(403)
  })

  it('PageFile-связь с доступной страницей даёт доступ', async () => {
    mocks.fileFindUnique.mockResolvedValue({ ...baseFile, workspaceId: null })
    mocks.getSession.mockResolvedValue({ user: { id: 'reader' } })
    mocks.pageFileFindFirst.mockResolvedValue({ pageId: 'p1' })
    const res = await authorizeFileRead('f1')
    expect(res.ok).toBe(true)
  })
})
```

Run: `pnpm --filter web exec vitest run test/file-access.test.ts`
Expected: FAIL — module not found

- [ ] **Step 2: Extract `authorizeFileRead`**

```ts
// apps/web/src/lib/file-access.ts
// Общая read-авторизация файла для /api/files/[id] и /api/files/[id]/preview-pdf.
// Дословный перенос логики из files/[id]/route.ts — поведение не менялось.

import { prisma } from '@repo/db'
import type { File } from '@repo/db'

import { getSession } from '@/lib/get-session'

export type FileReadResult = { ok: true; file: File } | { ok: false; response: Response }

export async function authorizeFileRead(id: string): Promise<FileReadResult> {
  const file = await prisma.file.findUnique({ where: { id } })
  if (!file || file.status !== 'ACTIVE') {
    return { ok: false, response: new Response('Not found', { status: 404 }) }
  }

  if (file.expiresAt && file.expiresAt.getTime() < Date.now()) {
    return { ok: false, response: new Response('Gone', { status: 410 }) }
  }

  if (!file.isPublic) {
    const session = await getSession()
    if (!session) return { ok: false, response: new Response('Unauthorized', { status: 401 }) }
    if (session.user.id !== file.userId) {
      // Allow download if the file is an ACTIVE file in a workspace the user belongs to…
      let authorized = false

      if (file.workspaceId && file.status === 'ACTIVE') {
        const member = await prisma.workspaceMember.findUnique({
          where: {
            workspaceId_userId: { workspaceId: file.workspaceId, userId: session.user.id },
          },
          select: { userId: true },
        })
        if (member) {
          // Active membership only: a workspace block kills file access. Inline
          // one-liner mirror of @repo/domain `PeopleService.isWorkspaceBlocked`.
          const blocked = await prisma.workspaceBlockedUser.findUnique({
            where: {
              workspaceId_userId: { workspaceId: file.workspaceId, userId: session.user.id },
            },
            select: { id: true },
          })
          if (!blocked) authorized = true
        }
      }

      // …or attached to a page in a workspace the user belongs to (and is not blocked in).
      if (!authorized) {
        const linked = await prisma.pageFile.findFirst({
          where: {
            fileId: file.id,
            page: {
              deletedAt: null,
              workspace: {
                members: { some: { userId: session.user.id } },
                blockedUsers: { none: { userId: session.user.id } },
              },
            },
          },
          select: { pageId: true },
        })
        if (linked) authorized = true
      }

      if (!authorized) {
        return { ok: false, response: new Response('Forbidden', { status: 403 }) }
      }
    }
  }

  return { ok: true, file }
}
```

Если `import type { File } from '@repo/db'` не резолвится (тип не реэкспортирован) — использовать `Awaited<ReturnType<typeof prisma.file.findUniqueOrThrow>>`-подход: `export type FileRecord = NonNullable<Awaited<ReturnType<typeof prisma.file.findUnique>>>` и вернуть его.

- [ ] **Step 3: Refactor the existing route**

`apps/web/src/app/api/files/[id]/route.ts` — заменить строки 12-79 (весь блок от `const file = await prisma.file.findUnique…` до конца авторизации) на:

```ts
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const access = await authorizeFileRead(id)
  if (!access.ok) return access.response
  const file = access.file
```

Импорты: убрать ставшие ненужными `prisma`? НЕТ — `prisma` ещё используется для `downloadCount` (строка 91). Убрать только `getSession` импорт; добавить:

```ts
import { authorizeFileRead } from '@/lib/file-access'
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter web exec vitest run test/file-access.test.ts && pnpm --filter web test`
Expected: новый тест PASS; вся web-сюита зелёная (поведение роута не изменилось)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/file-access.ts apps/web/src/app/api/files/[id]/route.ts \
  apps/web/test/file-access.test.ts
git commit -m "refactor(web): выделен authorizeFileRead из файлового роута"
```

---

### Task 12: `officeToPdf` в `@repo/page-export`

**Files:**
- Create: `packages/page-export/src/office-to-pdf.ts`
- Modify: `packages/page-export/src/index.ts`
- Test: `packages/page-export/src/office-to-pdf.test.ts`

Пакет NodeNext-чистый: явные `.ts`-расширения импортов, erasable-only синтаксис (без enum/параметр-свойств).

- [ ] **Step 1: Write the failing test** (по образцу `html-to-pdf.test.ts` — открой его и сверь стиль стабов; ниже — самодостаточная версия)

```ts
// packages/page-export/src/office-to-pdf.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  GotenbergTimeoutError,
  GotenbergUnreachableError,
  GotenbergUpstreamError,
} from './errors.ts'
import { officeToPdf } from './office-to-pdf.ts'

const BYTES = new Uint8Array([1, 2, 3])

describe('officeToPdf', () => {
  beforeEach(() => {
    vi.stubEnv('GOTENBERG_URL', 'http://gotenberg:3000')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('POSTит файл на /forms/libreoffice/convert с оригинальным именем', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Blob([new Uint8Array([37, 80, 68, 70])]), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const stream = await officeToPdf(BYTES, 'Отчёт.docx')
    expect(stream).toBeTruthy()

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://gotenberg:3000/forms/libreoffice/convert')
    const fd = init.body as FormData
    const file = fd.get('files') as globalThis.File
    expect(file.name).toBe('Отчёт.docx')
  })

  it('кидает GotenbergUnreachableError без GOTENBERG_URL', async () => {
    vi.stubEnv('GOTENBERG_URL', '')
    await expect(officeToPdf(BYTES, 'a.docx')).rejects.toBeInstanceOf(GotenbergUnreachableError)
  })

  it('кидает GotenbergTimeoutError на таймауте', async () => {
    const err = new Error('timeout')
    err.name = 'TimeoutError'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err))
    await expect(officeToPdf(BYTES, 'a.docx')).rejects.toBeInstanceOf(GotenbergTimeoutError)
  })

  it('кидает GotenbergUpstreamError на не-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })))
    await expect(officeToPdf(BYTES, 'a.docx')).rejects.toBeInstanceOf(GotenbergUpstreamError)
  })
})
```

Run: `pnpm --filter @repo/page-export test`
Expected: FAIL — module not found

- [ ] **Step 2: Implement**

```ts
// packages/page-export/src/office-to-pdf.ts
import {
  GotenbergTimeoutError,
  GotenbergUnreachableError,
  GotenbergUpstreamError,
} from './errors.ts'

const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Конвертирует office-документ (doc/docx/xls/xlsx/ppt/pptx/odt/ods/odp/rtf) в
 * PDF через LibreOffice-роут Gotenberg. Расширение в `filename` обязательно —
 * по нему LibreOffice определяет входной формат.
 */
export async function officeToPdf(
  bytes: Uint8Array,
  filename: string,
): Promise<ReadableStream<Uint8Array>> {
  const base = process.env.GOTENBERG_URL
  if (!base) throw new GotenbergUnreachableError('GOTENBERG_URL is not configured')
  const url = `${base}/forms/libreoffice/convert`
  const timeoutMs = Number(process.env.GOTENBERG_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS)

  const fd = new FormData()
  fd.append('files', new Blob([bytes]), filename)

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      body: fd,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    const name = (err as Error).name
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new GotenbergTimeoutError()
    }
    throw new GotenbergUnreachableError((err as Error).message)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new GotenbergUpstreamError(res.status, body)
  }
  if (!res.body) {
    throw new GotenbergUpstreamError(200, 'empty body')
  }
  return res.body
}
```

В `packages/page-export/src/index.ts` после `export { htmlToPdf } …` добавить:

```ts
export { officeToPdf } from './office-to-pdf.ts'
```

- [ ] **Step 3: Run test to verify it passes**

Run: `pnpm --filter @repo/page-export test`
Expected: PASS (включая существующие)

- [ ] **Step 4: Commit**

```bash
git add packages/page-export/src/office-to-pdf.ts packages/page-export/src/office-to-pdf.test.ts \
  packages/page-export/src/index.ts
git commit -m "feat(page-export): officeToPdf — конвертация office-документов через Gotenberg LibreOffice"
```

---

### Task 13: Роут `GET /api/files/[id]/preview-pdf`

**Files:**
- Create: `apps/web/src/app/api/files/[id]/preview-pdf/route.ts`
- Test: `apps/web/test/api-files-preview-pdf.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/test/api-files-preview-pdf.test.ts
import { Readable } from 'node:stream'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorizeFileRead: vi.fn(),
  exists: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  officeToPdf: vi.fn(),
}))

vi.mock('@/lib/file-access', () => ({ authorizeFileRead: mocks.authorizeFileRead }))
vi.mock('@repo/storage', () => ({
  storage: { exists: mocks.exists, get: mocks.get, put: mocks.put },
}))
vi.mock('@repo/page-export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/page-export')>()
  return { ...actual, officeToPdf: mocks.officeToPdf }
})

import { GotenbergTimeoutError, GotenbergUnreachableError } from '@repo/page-export'

import { GET } from '../src/app/api/files/[id]/preview-pdf/route'

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const req = new Request('http://localhost/api/files/f1/preview-pdf')

const officeFile = {
  id: 'f1',
  name: 'Отчёт',
  ext: 'docx',
  hash: 'abc123',
  path: 'ab/abc123.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

const pdfStream = () =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([37, 80, 68, 70]))
      controller.close()
    },
  })

describe('GET /api/files/[id]/preview-pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authorizeFileRead.mockResolvedValue({ ok: true, file: officeFile })
    mocks.put.mockResolvedValue(undefined)
  })

  it('пробрасывает отказ авторизации как есть', async () => {
    mocks.authorizeFileRead.mockResolvedValue({
      ok: false,
      response: new Response('Forbidden', { status: 403 }),
    })
    const res = await GET(req as never, params('f1'))
    expect(res.status).toBe(403)
    expect(mocks.officeToPdf).not.toHaveBeenCalled()
  })

  it('415 для не-office файла', async () => {
    mocks.authorizeFileRead.mockResolvedValue({
      ok: true,
      file: { ...officeFile, mimeType: 'text/plain', ext: 'txt' },
    })
    const res = await GET(req as never, params('f1'))
    expect(res.status).toBe(415)
  })

  it('кэш-хит: отдаёт из S3 без конвертации', async () => {
    mocks.exists.mockResolvedValue(true)
    mocks.get.mockResolvedValue(Readable.from(Buffer.from('%PDF-cached')))
    const res = await GET(req as never, params('f1'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(mocks.exists).toHaveBeenCalledWith('preview-pdf/abc123.pdf')
    expect(mocks.officeToPdf).not.toHaveBeenCalled()
  })

  it('конвертирует, кэширует и отдаёт PDF', async () => {
    mocks.exists.mockResolvedValue(false)
    mocks.get.mockResolvedValue(Readable.from(Buffer.from('docx-bytes')))
    mocks.officeToPdf.mockResolvedValue(pdfStream())
    const res = await GET(req as never, params('f1'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toContain('inline')
    expect(mocks.officeToPdf).toHaveBeenCalledWith(expect.any(Uint8Array), 'Отчёт.docx')
    expect(mocks.put).toHaveBeenCalledWith(
      'preview-pdf/abc123.pdf',
      expect.anything(),
      expect.objectContaining({ contentType: 'application/pdf' }),
    )
  })

  it('504 на таймауте Gotenberg, 502 на недоступности', async () => {
    mocks.exists.mockResolvedValue(false)
    mocks.get.mockResolvedValue(Readable.from(Buffer.from('x')))
    mocks.officeToPdf.mockRejectedValue(new GotenbergTimeoutError())
    expect((await GET(req as never, params('f1'))).status).toBe(504)

    mocks.get.mockResolvedValue(Readable.from(Buffer.from('x')))
    mocks.officeToPdf.mockRejectedValue(new GotenbergUnreachableError('down'))
    expect((await GET(req as never, params('f1'))).status).toBe(502)
  })
})
```

Run: `pnpm --filter web exec vitest run test/api-files-preview-pdf.test.ts`
Expected: FAIL — route module not found

- [ ] **Step 2: Implement the route**

```ts
// apps/web/src/app/api/files/[id]/preview-pdf/route.ts
import { Readable } from 'node:stream'

import { GotenbergTimeoutError, officeToPdf } from '@repo/page-export'
import { storage } from '@repo/storage'
import type { NextRequest } from 'next/server'

import { authorizeFileRead } from '@/lib/file-access'
import { resolvePreviewType } from '@/lib/preview-kind'

export const runtime = 'nodejs'

// Office-файл → PDF для просмотрщика (spec §6). Результат детерминирован
// содержимым (файлы content-addressed по hash), поэтому кэшируется в S3
// навсегда; авторизация — та же, что у /api/files/[id].

const pdfHeaders = (extra?: Record<string, string>) => ({
  'Content-Type': 'application/pdf',
  'Content-Disposition': 'inline; filename="preview.pdf"',
  'Cache-Control': 'private, max-age=86400',
  'X-Content-Type-Options': 'nosniff',
  ...extra,
})

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const access = await authorizeFileRead(id)
  if (!access.ok) return access.response
  const file = access.file

  if (resolvePreviewType(file.mimeType, file.ext) !== 'office') {
    return new Response('Unsupported media type', { status: 415 })
  }

  const cacheKey = `preview-pdf/${file.hash || file.id}.pdf`

  if (await storage.exists(cacheKey).catch(() => false)) {
    const cached = (await storage.get(cacheKey)) as Readable
    const stream = Readable.toWeb(cached) as unknown as ReadableStream<Uint8Array>
    return new Response(stream, { status: 200, headers: pdfHeaders() })
  }

  let source: Readable
  try {
    source = (await storage.get(file.path)) as Readable
  } catch {
    return new Response('Not found', { status: 404 })
  }
  const chunks: Buffer[] = []
  for await (const chunk of source) chunks.push(chunk as Buffer)
  const bytes = new Uint8Array(Buffer.concat(chunks))

  const filename = file.ext ? `${file.name}.${file.ext}` : file.name

  let pdfStream: ReadableStream<Uint8Array>
  try {
    pdfStream = await officeToPdf(bytes, filename)
  } catch (err) {
    if (err instanceof GotenbergTimeoutError) {
      return new Response('PDF service timeout', { status: 504 })
    }
    return new Response('PDF service unavailable', { status: 502 })
  }

  // Буферизуем PDF, чтобы одновременно закэшировать и отдать (office-вложения
  // ≤ 50MB, результат обычно меньше исходника).
  const pdfBytes = Buffer.from(await new Response(pdfStream).arrayBuffer())
  await storage
    .put(cacheKey, pdfBytes, { contentType: 'application/pdf', size: pdfBytes.length })
    .catch(() => {
      // best-effort кэш: конвертация уже удалась, отдаём результат
    })

  return new Response(pdfBytes, {
    status: 200,
    headers: pdfHeaders({ 'Content-Length': String(pdfBytes.length) }),
  })
}
```

Примечание: если `storage.put` не принимает `Buffer` по типам контракта — привести как `pdfBytes as unknown as Parameters<typeof storage.put>[1]` НЕ НАДО; вместо этого посмотри `packages/storage/src/contract.ts` и передай допустимый тип (Upload из lib-storage принимает Buffer/Readable — при type-ошибке оберни `Readable.from(pdfBytes)`).

- [ ] **Step 3: Run tests**

Run: `pnpm --filter web exec vitest run test/api-files-preview-pdf.test.ts && pnpm --filter web check-types`
Expected: PASS / 0 errors

- [ ] **Step 4: Ручная проверка конвертации (Gotenberg из compose)**

```bash
docker compose up -d
# загрузить docx в работающем приложении (слэш «Файл») и открыть его карточку —
# либо curl'ом по известному fileId с session-cookie:
# curl -s -o /tmp/preview.pdf -w "%{http_code}" -b "<cookie>" http://localhost:3000/api/files/<id>/preview-pdf
```

Expected: `200`, `/tmp/preview.pdf` открывается как PDF.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/api/files/[id]/preview-pdf/route.ts" \
  apps/web/test/api-files-preview-pdf.test.ts
git commit -m "feat(web): роут preview-pdf — office → PDF через Gotenberg с S3-кэшем"
```

---

### Task 14: E2E — сплит ↔ фуллскрин

**Files:**
- Create: `apps/e2e/file-preview.spec.ts`

Паттерны (хелперы файл-локальные, как в `apps/e2e/editor-slash-media.spec.ts:4-77`): `signUpAndCreateWorkspace`, `createTextPage`, `openSlashMenu`, `MIN_PNG_BASE64`, `MIN_PDF`. Ассерты только in-session (в E2E нет yjs-персиста — без перезагрузок).

- [ ] **Step 1: Write the spec**

```ts
// apps/e2e/file-preview.spec.ts
import { expect, test, type Locator, type Page } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

// 1x1 transparent PNG (see editor-slash-media.spec.ts)
const MIN_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII='
const MIN_PDF = '%PDF-1.1\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'

const password = 'SuperSecure123!'

test.setTimeout(180_000)

async function signUpAndCreateWorkspace(page: Page, tag: string) {
  const email = `${tag}+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Просмотр', lastName: 'Тестов' })
  await page.getByRole('textbox', { name: 'Название' }).fill('File Preview Test')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/(pages|chats)\//)
}

async function createTextPage(page: Page) {
  const previousUrl = page.url()
  await page.getByRole('button', { name: 'Новая страница' }).first().click()
  await page.getByRole('button', { name: 'Создать страницу: Текст' }).click()
  await page.waitForURL(
    (url) => /\/pages\/[a-f0-9-]+/.test(url.toString()) && url.toString() !== previousUrl,
    { timeout: 15_000 },
  )
  const editor = page.locator('.anynote-editor .ProseMirror')
  await expect(editor).toBeVisible({ timeout: 15_000 })
  return editor
}

async function openSlashMenu(editor: Locator) {
  await editor.click()
  await editor.press('/')
}

async function insertImage(page: Page, editor: Locator) {
  await openSlashMenu(editor)
  await page.getByText('Картинка', { exact: true }).click()
  const emptyBlock = editor.locator('[data-type="image"][data-empty="true"]')
  await expect(emptyBlock).toBeVisible({ timeout: 5_000 })
  const fileChooserPromise = page.waitForEvent('filechooser')
  await emptyBlock.click()
  const chooser = await fileChooserPromise
  await chooser.setFiles({
    name: 'preview-test.png',
    mimeType: 'image/png',
    buffer: Buffer.from(MIN_PNG_BASE64, 'base64'),
  })
  const img = editor.locator('[data-type="image"] img[src^="/api/files/"]')
  await expect(img).toBeVisible({ timeout: 15_000 })
  return img
}

test('dblclick по картинке открывает сплит-панель; OpenInFull/CloseFullscreen переключают режимы', async ({
  page,
}) => {
  await signUpAndCreateWorkspace(page, 'file-preview-image')
  const editor = await createTextPage(page)
  const img = await insertImage(page, editor)

  // Страница редактируемая → просмотр открывает двойной клик (спека §2).
  await img.dblclick()
  const sidebar = page.getByTestId('file-preview-sidebar')
  await expect(sidebar).toBeVisible()
  // Сплит: документ остаётся видимым слева.
  await expect(editor).toBeVisible()
  await expect(sidebar.locator('img')).toBeVisible()

  // Сплит → фуллскрин.
  await page.getByTestId('file-preview-expand').click()
  const dialog = page.getByTestId('file-preview-dialog')
  await expect(dialog).toBeVisible()
  await expect(page.getByTestId('file-preview-collapse')).toBeVisible()

  // Фуллскрин → сплит.
  await page.getByTestId('file-preview-collapse').click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByTestId('file-preview-sidebar')).toBeVisible()

  // Закрытие.
  await page.getByTestId('file-preview-close').click()
  await expect(page.getByTestId('file-preview-sidebar')).not.toBeVisible()
})

test('клик по карточке PDF-вложения открывает встроенный просмотр PDF', async ({ page }) => {
  await signUpAndCreateWorkspace(page, 'file-preview-pdf')
  const editor = await createTextPage(page)

  await openSlashMenu(editor)
  await page.getByText('Файл', { exact: true }).click()
  const fileChooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Выбрать файлы' }).click()
  const chooser = await fileChooserPromise
  await chooser.setFiles({
    name: 'preview-test.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(MIN_PDF, 'binary'),
  })

  const attachment = editor.locator('.anynote-file-attachment', { hasText: 'preview-test.pdf' })
  await expect(attachment).toBeVisible({ timeout: 15_000 })

  // Клик по имени файла = клик по карточке (иконка скачивания гасит
  // всплытие и просмотр не открывает — это отдельное поведение).
  await attachment.getByText('preview-test.pdf').click()

  const sidebar = page.getByTestId('file-preview-sidebar')
  await expect(sidebar).toBeVisible()
  await expect(page.getByTestId('file-preview-pdf-frame')).toBeVisible()
})
```

- [ ] **Step 2: Run the spec**

```bash
docker compose up -d
pnpm exec playwright test apps/e2e/file-preview.spec.ts --retries=1
```

Expected: 2 passed (памятка: холодный next-dev может уронить первую попытку на signup — retries прогревает).

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/file-preview.spec.ts
git commit -m "test(e2e): просмотр файлов — сплит-панель, фуллскрин, PDF-вложение"
```

---

### Task 15: Полные gates + финализация

- [ ] **Step 1: Full gates**

Run: `pnpm gates`
Expected: check-types + lint + check-architecture + build + test — всё зелёное. Husky-хук в этом чекауте gates НЕ гоняет — этот шаг обязателен.

Типовые падения и лечение:
- `--max-warnings 0` — не оставляй неиспользуемых импортов;
- web check-types TS2307 на `.next/types` — `rm -rf apps/web/.next/types` и повторить;
- editor-тесты «document is not defined» после teardown — см. memory: afterEach уже дренирует тик, новые тесты не должны монтировать Tiptap.

- [ ] **Step 2: Прогнать e2e ещё раз на тёплом сервере**

Run: `pnpm exec playwright test apps/e2e/file-preview.spec.ts`
Expected: 2 passed

- [ ] **Step 3: Commit leftovers (если gates потребовали правок)**

```bash
git add -u
git commit -m "fix(web): правки по итогам gates"
```

- [ ] **Step 4: Финиш**

Ветка `feat/file-preview-viewer` готова к ревью/мержу — использовать skill `superpowers:finishing-a-development-branch`.

---

## Self-Review (выполнен при написании плана)

**Spec coverage:** §1 контракт → Task 2; §2 триггеры → Tasks 3-6; §3 resolvePreviewType → Task 1; §4 панель/фуллскрин/оффсеты → Tasks 7, 9, 10; §5 просмотрщики → Task 8; §6 роут office→PDF → Tasks 11-13; §8 тесты → в каждой задаче + Task 14 (E2E) + Task 15 (gates). Вне скоупа (§7) — не реализуем.

**Известные допущения:**
1. `import type { File } from '@repo/db'` — если тип не реэкспортируется, в Task 11 описан фолбэк через `ReturnType`.
2. Экспорт `InsertDriveFileOutlinedIcon`/`Dialog`/`Button` из `@repo/ui/components` — проверяется по месту (Task 8/9), добавление одной строки экспорта разрешено.
3. E2E-клик по карточке вложения — основной вариант через `getByText`.
