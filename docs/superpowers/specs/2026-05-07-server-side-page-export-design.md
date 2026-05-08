---
status: draft
date: 2026-05-07
topic: Server-side page export to PDF / HTML / Markdown (TEXT pages)
---

# Server-side Page Export — Design

## Goal

Replace client-side export of TEXT pages on `/workspaces/[workspaceId]/pages/[pageId]`
with server-side generation of PDF, HTML, and Markdown. The current client-side
PDF export uses `window.print()` with `@media print` style overrides; the layout
is unreliable and depends on the live editor DOM. We want predictable, server-
controlled output.

After this work:

1. Clicking PDF / HTML / Markdown in the page export dialog navigates to a single
   server route that returns the file with a download header.
2. PDF is rendered by Gotenberg (headless Chromium service) running in
   `compose.yml`; HTML and Markdown are produced by a server-side Tiptap JSON
   serializer in `apps/web`.
3. All three formats embed images as `data:` URIs so the downloaded file is
   self-contained (HTML opens offline; PDF needs no Gotenberg→S3 auth).
4. Only `PageType.TEXT` pages are exportable, matching today's UI gating.

## Non-goals

- Export of `EXCALIDRAW`, `GENOGRAM`, `DATABASE`, or `KANBAN` pages. The export
  button stays disabled for these as it is today.
- Bulk export of multiple pages or whole workspaces; one page per request.
- Async generation, job queues, S3-backed result storage, or signed URLs.
  Generation is synchronous and stream-responded.
- PDF page numbers, headers, footers, table of contents, watermarks, custom
  branding, or user-selectable styles.
- Force-flush of Yjs documents before export; we read `Page.content` JSON
  snapshot and accept the few-second Hocuspocus debounce window as stale.
- Server-side decoding of `Page.contentYjs` bytes.
- Production deployment of Gotenberg. The spec fixes requirements (private
  network, no public exposure); the actual prod compose / k8s manifest is a
  DevOps task that must land before this branch is merged but is tracked
  separately.
- Metrics / observability dashboards for the export endpoint. Structured
  logs only.
- Per-user rate limiting or concurrency control on the endpoint. Gotenberg
  queues internally.
- Custom filename input from the UI. Filename is derived from `page.title`.
- Embedding `fileAttachment` bodies. They stay as absolute-URL links.
- Editor-side preview of "what the PDF will look like".
- Guest / share-link export; only authenticated workspace members.
- Removal of `turndown` from the client bundle is not a goal (it may follow
  from tree-shaking, but the spec does not require it).
- Pixel-level visual regression testing of PDFs.

## Current state (summary)

- Export trigger lives in `apps/web/src/components/page/page-actions-menu.tsx`.
  The "Экспортировать" item is disabled when `pageType !== 'TEXT'`.
- The dialog is `apps/web/src/components/page/page-export-dialog.tsx`. Three
  buttons each call a `useCallback` that:
  - **PDF:** injects an inline `<style data-print-override>` with `@media print`
    rules that hide nav/sidebar/dialogs and tweak editor padding, then calls
    `window.print()`. Cleans up the style on `afterprint`.
  - **HTML:** calls `editor.getHTML()`, wraps in a hand-built `<!DOCTYPE html>`
    document with inline CSS, and downloads via `Blob`.
  - **Markdown:** `editor.getHTML()` → `editorHtmlToMarkdown(html)` (turndown)
    → download.
- `editorHtmlToMarkdown` is in `apps/web/src/lib/editor-to-markdown.ts`. It
  uses `turndown` 7.2.4 with custom rules for `callout`, `toggle`, `hiddenText`,
  and `fileAttachment`.
- `Page` schema (`packages/db/prisma/schema.prisma`):
  - `content: Json?` — Tiptap JSON snapshot.
  - `contentYjs: Bytes?` — authoritative Yjs binary.
  - `title`, `icon`, `type` (`PageType`), `archived`, `deletedAt`.
- `Page.content` is written atomically with `contentYjs` by Hocuspocus on every
  persistence cycle (`apps/yjs/src/persistence.ts` `storePageDocument`, via
  `TiptapTransformer.fromYdoc(document, 'default')`). Snapshot freshness is
  bounded by Hocuspocus debounce (a few seconds).
- Editor extensions are built by `buildExtensions(opts)` in
  `packages/editor/src/extensions/index.ts`. Standard Tiptap extensions plus
  custom ones: `Callout`, `Toggle`, `HiddenText`, `FileAttachment`, `PageLink`,
  `BlockBackground`, `AnynoteTextColor`, `ResizableImage`,
  `TaskItemWithCheckbox`, `BlockIndexAttributes`.
- Page text extractor exists for search: `extractText(node)` walker in
  `packages/trpc/src/services/page-search.ts`. Plain-text only; not reusable
  for HTML/MD output but confirms the JSON shape.
- tRPC `page` router has no export procedures today.
- `assertWorkspaceMember` is duplicated across four tRPC routers (page,
  search, etc.) — captured in the workspace-search post-mortem; this spec uses
  the duplication as the trigger to extract it into a shared utility.
- No server-side PDF tooling installed: no `puppeteer`, `playwright-core`,
  `chromium`, `weasyprint`, `wkhtmltopdf`, `@react-pdf`, `jspdf`, or `html2pdf`
  in any `package.json`. `@playwright/test` is devDep-only for E2E.
- `compose.yml` runs Postgres, MinIO, Qdrant, Mailhog. No Gotenberg.

## Approach

Five architectural choices, each picked from 2–3 alternatives during
brainstorming:

| Decision                         | Chosen                                                                                       | Rejected                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Page-type scope                  | TEXT only                                                                                    | Include Excalidraw / Genogram                                 |
| Visual style                     | Documental layout + branded blocks (callout, code, table preserved)                          | Plain document; full WYSIWYG of editor                        |
| PDF rendering tech               | **Gotenberg as separate compose service**                                                    | Playwright in `apps/web`; WeasyPrint in `apps/agents`         |
| Delivery mechanism               | Next.js route handler that streams `Response` with `Content-Disposition`                     | tRPC procedure returning base64; tRPC + S3 signed URL         |
| Content source                   | `Page.content` JSON snapshot                                                                 | Decode `Page.contentYjs` server-side; hybrid with force-flush |
| Image / asset handling           | Embed `<img>` as `data:` URIs (HTML/MD/PDF self-contained); `fileAttachment` as absolute URL | Presigned S3 URLs; embed only for PDF                         |
| Internal page links (`PageLink`) | Replace with absolute URL using `NEXT_PUBLIC_BASE_URL`                                       | Strip to plain text                                           |

Gotenberg is chosen over Playwright-in-`apps/web` to keep the Chromium binary
out of the `apps/web` image and isolate the heavy renderer behind a private
HTTP boundary. Gotenberg is chosen over WeasyPrint because the documental
style relies on Chromium-grade CSS for callout backgrounds, code-block syntax
highlighting, table borders, and `page-break-inside: avoid` rules.

`Page.content` JSON snapshot is chosen over Yjs decoding because Hocuspocus
already writes the snapshot atomically; the rare staleness window (sub-second
typing burst before debounce) is acceptable for a manual export action.

Image data-URI embedding is chosen over presigned URLs because the current
HTML export is effectively broken offline (links to authed `/api/files/[id]`)
and we want the server-side rewrite to fix this, not preserve it.

## Architecture

```
Browser (page-export-dialog.tsx)
   │
   │  fetch GET /api/workspaces/:wsId/pages/:pageId/export/:format
   ▼
Next.js route handler (apps/web)
   │  1. getSession()  → redirect /sign-in if null
   │  2. assertWorkspaceMember(prisma, userId, wsId)
   │  3. SELECT id, title, icon, type, content, deletedAt
   │     FROM pages WHERE id = :pageId AND workspace_id = :wsId
   │     → 404 if missing / deletedAt != null / type != 'TEXT'
   │  4. tiptapJsonToHtml(content)                      → bodyHtml (no <html><head>)
   │  5. embedImagesAndRewriteLinks(bodyHtml)           → bodyHtml with data: URIs
   │
   ├─ format=html ─▶ wrapHtmlDocument(bodyHtml, title, icon)
   │                  ─▶ Response(html, text/html; attachment)
   ├─ format=md   ─▶ htmlToMarkdown(bodyHtml) prepended with "# ${title}\n\n"
   │                  ─▶ Response(md, text/markdown; attachment)
   └─ format=pdf  ─▶ wrapHtmlDocument(bodyHtml, title, icon)
                      ─▶ htmlToPdf(html)
                      ─▶ Response(stream, application/pdf; attachment)
                          │
                          ▼
                     POST $GOTENBERG_URL/forms/chromium/convert/html
                     multipart/form-data:
                       - index.html  (our HTML)
                       - paperWidth=8.27 paperHeight=11.69
                       - marginTop=0.7 marginBottom=0.7
                         marginLeft=0.7 marginRight=0.7
                       - printBackground=true
                     ──▶ application/pdf body (streamed)
```

### Module layout

```
apps/web/src/app/api/workspaces/[workspaceId]/pages/[pageId]/export/[format]/
  └─ route.ts                       # GET handler (Node runtime)

apps/web/src/server/page-export/
  ├─ index.ts                       # public re-exports
  ├─ tiptap-to-html.ts              # generateHTML(json, serverExtensions)
  ├─ server-extensions.ts           # schema-only Tiptap extension list for SSR
  ├─ embed-images.ts                # rewrite <img src> → data: URI; rewrite pageLink
  ├─ html-to-markdown.ts            # turndown wrapper, ported from lib/editor-to-markdown
  ├─ html-to-pdf.ts                 # Gotenberg client
  ├─ wrap-html-document.ts          # builds full <!doctype html>... with print stylesheet
  ├─ print-stylesheet.ts            # exports CSS string (the documental style)
  ├─ filename.ts                    # sanitize title, build RFC 5987 Content-Disposition
  └─ errors.ts                      # GotenbergTimeoutError / GotenbergUpstreamError

packages/trpc/src/services/
  └─ workspace-access.ts            # extracted assertWorkspaceMember(prisma, userId, wsId)
                                    # used by both tRPC routers and the export route handler

apps/web/src/components/page/
  └─ page-export-dialog.tsx         # rewritten: 3 buttons → 3 download navigations
```

### Modified or removed

- `apps/web/src/lib/editor-to-markdown.ts` — **removed**. Logic moves to
  `apps/web/src/server/page-export/html-to-markdown.ts`.
- `apps/web/src/components/page/page-export-dialog.tsx` — gutted of all
  client-side serialization. Becomes a thin dialog with three download
  triggers.
- `apps/web/next.config.js` — may need entries in `serverExternalPackages`
  for `@tiptap/html` and `linkedom`/`zeed-dom` if Next bundler cannot handle
  them. Confirm during implementation.
- `compose.yml` — new `gotenberg` service.
- `.env.example` — adds `GOTENBERG_URL`, `GOTENBERG_TIMEOUT_MS`.
- `turbo.json` `globalEnv` — same two keys mirrored.
- `packages/trpc/src/routers/page.ts` (and others) — switch the duplicated
  `assertWorkspaceMember` callsites to the extracted utility. This is purely
  a refactor; no behavior change.

## Components

### `route.ts` — `GET /api/workspaces/[workspaceId]/pages/[pageId]/export/[format]`

```ts
export const runtime = 'nodejs'

const FormatSchema = z.enum(['pdf', 'html', 'md'])
const ParamsSchema = z.object({
  workspaceId: z.string().uuid(),
  pageId: z.string().uuid(),
  format: FormatSchema,
})

export async function GET(req: NextRequest, ctx: { params: Promise<...> }) {
  const params = ParamsSchema.safeParse(await ctx.params)
  if (!params.success) return new Response(null, { status: 404 })

  const session = await getSession()
  if (!session) {
    const next = new URL(req.url).pathname
    return Response.redirect(new URL(`/sign-in?next=${encodeURIComponent(next)}`, req.url))
  }

  await assertWorkspaceMember(prisma, session.user.id, params.data.workspaceId)
  // ↑ throws TRPCError-like with code 'FORBIDDEN' on miss; route handler
  //   converts to 403 JSON

  const page = await prisma.page.findFirst({
    where: {
      id: params.data.pageId,
      workspaceId: params.data.workspaceId,
      deletedAt: null,
      type: 'TEXT',
    },
    select: { id: true, title: true, icon: true, content: true },
  })
  if (!page) return new Response(null, { status: 404 })

  const titleForOutput = (page.title ?? '').trim() || 'Без названия'
  const rawBody = tiptapJsonToHtml(page.content) // empty string if content == null
  const bodyHtml = await embedImagesAndRewriteLinks(rawBody, { storage, baseUrl })
  const filename = buildFilename(page.title, params.data.format)

  switch (params.data.format) {
    case 'html': {
      const fullHtml = wrapHtmlDocument({ bodyHtml, title: titleForOutput, icon: page.icon })
      return new Response(fullHtml, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-disposition': contentDisposition(filename),
        },
      })
    }
    case 'md': {
      const md = `# ${titleForOutput}\n\n${htmlToMarkdown(bodyHtml)}`
      return new Response(md, {
        headers: {
          'content-type': 'text/markdown; charset=utf-8',
          'content-disposition': contentDisposition(filename),
        },
      })
    }
    case 'pdf': {
      const fullHtml = wrapHtmlDocument({ bodyHtml, title: titleForOutput, icon: page.icon })
      const pdfStream = await htmlToPdf(fullHtml) // ReadableStream<Uint8Array>
      return new Response(pdfStream, {
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': contentDisposition(filename),
        },
      })
    }
  }
}
```

Errors mapped:

- Unauth → 302 to `/sign-in?next=...`.
- `assertWorkspaceMember` throws → 403 JSON `{ error: 'Forbidden' }`.
- Page missing / non-TEXT / soft-deleted → 404.
- Invalid params → 404.
- `GotenbergTimeoutError` → 504.
- `GotenbergUpstreamError` (5xx from Gotenberg) → 502.
- Network error reaching Gotenberg → 502.
- Anything else → 500 with full stack to the logger only; client gets a
  generic body.

### `tiptap-to-html.ts`

```ts
import { generateHTML } from '@tiptap/html'
import { buildServerExtensions } from './server-extensions'

export function tiptapJsonToHtml(json: unknown): string {
  if (!json || typeof json !== 'object') return ''
  return generateHTML(json as JSONContent, buildServerExtensions())
}
```

`@tiptap/html` uses `zeed-dom` internally for SSR-safe DOM emulation. Call this
from the route handler in Node runtime.

### `server-extensions.ts`

Server-safe extensions list. Critical: custom extensions (`Callout`, `Toggle`,
`HiddenText`, `FileAttachment`, `PageLink`, `BlockBackground`,
`AnynoteTextColor`) are imported from `@repo/editor` and must be schema-pure
(parseHTML/renderHTML/addAttributes; no node-views, no keymaps, no upload
handlers, no `onNavigate` callbacks).

```ts
import { StarterKit } from '@tiptap/starter-kit'
import { Image } from '@tiptap/extension-image'
import { Link } from '@tiptap/extension-link'
import { Typography } from '@tiptap/extension-typography'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'

import {
  Callout,
  Toggle,
  HiddenText,
  FileAttachment,
  PageLink,
  BlockBackground,
  AnynoteTextColor,
} from '@repo/editor/extensions/server' // new sub-export, see below

const lowlight = createLowlight(common)

export function buildServerExtensions() {
  return [
    StarterKit.configure({ undoRedo: false }),
    Link.configure({ openOnClick: false }),
    Typography,
    AnynoteTextColor,
    BlockBackground,
    Image, // plain image, no upload
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    CodeBlockLowlight.configure({ lowlight }),
    Callout,
    Toggle,
    HiddenText,
    FileAttachment,
    PageLink,
  ]
}
```

If the existing `@repo/editor` extension files have browser-only side effects
(window/document/Yjs imports at module load), the implementation creates a
`@repo/editor/extensions/server` subpath that re-exports schema-only variants.
This is a small, surgical change and is captured in the implementation plan.

### `embed-images.ts`

Walks the rendered HTML once, mutating `<img>` and link nodes:

```ts
export async function embedImagesAndRewriteLinks(
  html: string,
  ctx: { storage: StorageClient; baseUrl: string },
): Promise<string>
```

Behavior per node:

- `<img src>` starts with `/api/files/<id>` → look up the file in the storage
  client, download bytes, base64-encode, replace `src` with
  `data:${mime};base64,${b64}`. Use `@repo/storage` directly to bypass the
  HTTP route and skip auth.
- `<img src>` starts with our public storage origin (e.g. MinIO public URL,
  controlled by env) — same as above.
- `<img src>` is already `data:` — leave as-is.
- `<img src>` is an external URL (different origin) — leave as-is.
- Any error fetching → `console.warn`-level log with pageId + src, leave the
  `<img>` unchanged. Never throw; one missing image must not fail the export.
- `<a href>` starts with `/workspaces/.../pages/...` (PageLink output) →
  prepend `baseUrl` to make it absolute.
- `<div data-type="file-attachment" data-url="/api/files/...">` → rewrite
  `data-url` and the wrapping `<a href>` to absolute `${baseUrl}/api/files/...`.

Concurrency: a small semaphore (default limit 8) so a 30-image page does not
exhaust the storage client connection pool. Implemented inline; no new dep.

DOM library: `linkedom` (small, fast, no JS execution) for the post-pass over
the HTML produced by `@tiptap/html`. Add to `apps/web/package.json`. (If during
implementation `@tiptap/html`'s internal DOM emulator is sufficient and
exposes a usable API, the dep can be skipped — the spec does not require
`linkedom` specifically, only a small server-safe DOM walker.)

### `html-to-markdown.ts`

Direct port of `apps/web/src/lib/editor-to-markdown.ts`. Same `turndown`
config, same custom rules for `callout`, `toggle`, `hiddenText`,
`fileAttachment`. No behavior changes; tests are ported alongside.

### `html-to-pdf.ts`

```ts
const TIMEOUT_MS = Number(process.env.GOTENBERG_TIMEOUT_MS ?? 30_000)
const GOTENBERG_URL = requireEnv('GOTENBERG_URL')

export async function htmlToPdf(html: string): Promise<ReadableStream<Uint8Array>> {
  const fd = new FormData()
  fd.append('files', new Blob([html], { type: 'text/html' }), 'index.html')
  fd.append('paperWidth', '8.27') // A4 in inches
  fd.append('paperHeight', '11.69')
  fd.append('marginTop', '0.7') // ≈ 18 mm
  fd.append('marginBottom', '0.7')
  fd.append('marginLeft', '0.7')
  fd.append('marginRight', '0.7')
  fd.append('printBackground', 'true')

  const res = await fetch(`${GOTENBERG_URL}/forms/chromium/convert/html`, {
    method: 'POST',
    body: fd,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((err) => {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new GotenbergTimeoutError()
    }
    throw new GotenbergUnreachableError(err.message)
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new GotenbergUpstreamError(res.status, body)
  }
  if (!res.body) throw new GotenbergUpstreamError(500, 'empty body')
  return res.body
}
```

The `ReadableStream` is passed straight to `new Response(stream, ...)` so the
PDF is never fully buffered in `apps/web` memory.

### `wrap-html-document.ts` and `print-stylesheet.ts`

```ts
export function wrapHtmlDocument(opts: {
  bodyHtml: string
  title: string
  icon: string | null
}): string {
  const titleEsc = escapeHtml(opts.title)
  const iconEsc = opts.icon ? escapeHtml(opts.icon) : ''
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>${titleEsc}</title>
<style>${PRINT_STYLESHEET}</style>
</head>
<body>
<h1 class="document-title">${iconEsc ? `${iconEsc} ` : ''}${titleEsc}</h1>
${opts.bodyHtml}
</body>
</html>`
}
```

`PRINT_STYLESHEET` is a single CSS string defined in `print-stylesheet.ts`,
covering:

- Page width 800px center-aligned, padding 24px (HTML viewing).
- System font stack, font-size 14px, line-height 1.55, color slate-800.
- Heading scale 28/22/18/16/15/14, font-weight 600, `page-break-after: avoid`.
- Paragraph, lists, tasklist (with checkbox alignment), blockquote, table
  (border 1px slate-300, header bg slate-50), pre (slate-50 bg, monospace,
  page-break-inside avoid), inline code (slate-50 bg, padding 1px 5px),
  image (max-width 100%, page-break-inside avoid), link (blue-600 underline).
- `lowlight` GitHub-light token classes inlined for code highlighting.
- Branded blocks:
  - `[data-type="callout"]` — flex, slate-50 bg (or extension's data-bg),
    rounded 6px, padding, ::before with `attr(data-emoji)`.
  - `[data-type="toggle"]` — always-expanded, left border, summary bold.
  - `[data-hidden-text]` / `.hidden-text` — yellow highlight, fully visible
    (this is a UI hide, not a security feature).
  - `[data-type="file-attachment"]` — flex with 📎 ::before, name from
    `data-name`, slate-50 bg, slate-200 border.
- Block-background and text-color marks rely on inline styles emitted by the
  extensions' `renderHTML`; the stylesheet doesn't override.
- `@page { size: A4; margin: 0; }` — Gotenberg controls margins via multipart
  parameters. `@page` block ensures HTML viewer uses A4 sizing too if printed.

The complete CSS lives in `print-stylesheet.ts` and is reviewed/iterated as
part of implementation; the spec captures the rules above as requirements.

### `filename.ts`

```ts
const FORMAT_EXT = { pdf: 'pdf', html: 'html', md: 'md' } as const
const UNSAFE = /[/\\:*?"<>|\x00-\x1f]+/g

export function buildFilename(rawTitle: string | null, format: 'pdf' | 'html' | 'md'): string {
  const trimmed = (rawTitle ?? '').trim() || 'Без названия'
  const safe = trimmed.replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)
  return `${safe || 'page'}.${FORMAT_EXT[format]}`
}

export function contentDisposition(filename: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
}
```

`filename*=UTF-8''...` is RFC 5987 syntax; required for non-ASCII (Cyrillic)
filenames to survive Chrome / Firefox / Safari downloads.

### `page-export-dialog.tsx` (rewrite)

Replaces all client-side serialization with three thin download triggers:

```tsx
function buildExportUrl(workspaceId: string, pageId: string, format: 'pdf' | 'html' | 'md') {
  return `/api/workspaces/${workspaceId}/pages/${pageId}/export/${format}`
}

const [pending, setPending] = useState<null | 'pdf' | 'html' | 'md'>(null)
const [error, setError] = useState<string | null>(null)

async function downloadAs(format: 'pdf' | 'html' | 'md') {
  setPending(format)
  setError(null)
  try {
    const url = buildExportUrl(workspaceId, pageId, format)
    const res = await fetch(url, { credentials: 'same-origin' })
    if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`)
    const blob = await res.blob()
    const filename =
      parseFilenameFromContentDisposition(res.headers.get('content-disposition')) ??
      `page.${format}`
    triggerBlobDownload(blob, filename)
    onClose()
  } catch (e) {
    setError(`Не удалось скачать ${format.toUpperCase()}. Попробуйте ещё раз.`)
  } finally {
    setPending(null)
  }
}
```

UI: three buttons, each shows a spinner while `pending === format`; an alert
above the buttons shows `error` if present. The `usePageEditor()` dependency
disappears — the dialog only needs `workspaceId` and `pageId`. `workspaceId`
is read from the existing page-context provider in the protected layout.

### `compose.yml` — Gotenberg service

```yaml
gotenberg:
  image: gotenberg/gotenberg:8
  container_name: anynote-gotenberg
  command:
    - 'gotenberg'
    - '--api-port=3000'
    - '--api-timeout=60s'
    - '--chromium-disable-javascript=true'
    - '--chromium-incognito=true'
    - '--log-level=warn'
  ports:
    - '3001:3000'
  healthcheck:
    test: ['CMD', 'curl', '-fsSL', 'http://localhost:3000/health']
    interval: 10s
    timeout: 3s
    retries: 5
  restart: unless-stopped
```

JavaScript is disabled because our HTML is fully prerendered (already had
images embedded as data: URIs). This removes a class of XSS-via-content
risks and speeds rendering.

Production: the spec mandates that `GOTENBERG_URL` resolves to a private
endpoint not exposed to the public internet. Gotenberg has no built-in
auth and would otherwise function as an open PDF-conversion relay. The
production manifest is out of scope for this spec but must be in place
before the feature branch merges to main.

### `assertWorkspaceMember` extraction

Currently duplicated in four tRPC routers. Move to
`packages/trpc/src/services/workspace-access.ts`:

```ts
export async function assertWorkspaceMember(
  prisma: PrismaClient,
  userId: string,
  workspaceId: string,
): Promise<void> {
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  })
  if (!membership) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a workspace member' })
  }
}
```

The export route handler catches `TRPCError` `code === 'FORBIDDEN'` and maps
to a 403 `Response`. tRPC routers re-use the same throw. No behavior change
for tRPC paths.

## Data flow examples

### PDF of a small TEXT page

1. User on `/workspaces/abc/pages/xyz` clicks Page menu → Экспортировать → PDF.
2. Dialog `fetch('/api/workspaces/abc/pages/xyz/export/pdf', { credentials })`.
3. Route handler validates session, asserts membership, loads page with
   `content` JSON.
4. `tiptapJsonToHtml(content)` produces body HTML (no `<html>` / `<head>`).
5. `embedImagesAndRewriteLinks(bodyHtml, { storage, baseUrl })` walks `<img>`
   nodes, fetches each `/api/files/<id>` directly via storage client, base64
   encodes, swaps `src`. Rewrites internal page links to absolute URLs.
6. For PDF only: `wrapHtmlDocument({ bodyHtml, title, icon })` wraps with
   `<!doctype html>...print stylesheet...`.
7. `htmlToPdf(fullHtml)` POSTs multipart to Gotenberg and returns the response
   `ReadableStream`.
8. Route handler returns `new Response(stream, { headers: 'application/pdf'
   - attachment Content-Disposition })`.
9. Browser receives the response, calls `await res.blob()`, triggers a
   blob-URL download with the parsed filename. Dialog closes.

### Markdown export

Steps 1–5 same as above. Step 6 is skipped — turndown receives the _body_ HTML
(no `<style>` / `<head>`) and produces clean Markdown. The route handler
prepends `# ${title}\n\n` to the turndown output before responding. Recipients
opening the `.md` file see a normal heading and content; embedded images render
as `![alt](data:image/...;base64,...)`, supported by GitHub, Obsidian, and
most Markdown viewers.

### HTML export with one missing image

Same as above through step 5. One `<img src="/api/files/missing-id">` fails
the storage fetch; `embedImagesAndRewriteLinks` logs a warn and leaves the
node unchanged. Step 6 wraps the HTML; HTML response is returned. Recipient
opens the file: 9 of 10 images render inline, 1 shows a broken-image icon
linking to `/api/files/missing-id`. Export succeeded; user can re-attempt
later.

### PDF when Gotenberg is down

Steps 1–6 succeed. Step 7: `fetch` throws `TimeoutError` after 30 s.
`htmlToPdf` rethrows as `GotenbergTimeoutError`. Route handler returns 504.
Dialog catches the non-2xx response, shows an error message. Page stays
intact; user can retry.

## Error handling

| Condition                                  | Response                             | Client behavior                                       |
| ------------------------------------------ | ------------------------------------ | ----------------------------------------------------- |
| No session                                 | 302 → `/sign-in?next=/api/...`       | Browser follows redirect.                             |
| Session, not workspace member              | 403 JSON `{ error: 'Forbidden' }`    | Dialog error message.                                 |
| Page not found / soft-deleted / non-TEXT   | 404 (empty)                          | Dialog error message.                                 |
| Invalid UUID / unknown format              | 404 (empty)                          | Same.                                                 |
| Gotenberg timeout                          | 504                                  | Dialog error message: "Не удалось сгенерировать PDF". |
| Gotenberg 5xx                              | 502                                  | Same.                                                 |
| Gotenberg unreachable (DNS / ECONNREFUSED) | 502                                  | Same.                                                 |
| Storage fetch failure (single image)       | export proceeds, image src untouched | None — silent.                                        |
| Tiptap JSON malformed                      | 500                                  | Dialog error message.                                 |
| Any uncaught exception                     | 500 with stack to log only           | Dialog generic error.                                 |

## Environment variables

Added to `.env.example` (root) **and** `turbo.json` `globalEnv`:

| Key                    | Default                 | Purpose                                                                                 |
| ---------------------- | ----------------------- | --------------------------------------------------------------------------------------- |
| `GOTENBERG_URL`        | `http://localhost:3001` | Base URL for `apps/web` → Gotenberg HTTP API. Must be a private endpoint in production. |
| `GOTENBERG_TIMEOUT_MS` | `30000`                 | Per-request timeout (ms) for Gotenberg. Must be ≤ Gotenberg `--api-timeout`.            |

`NEXT_PUBLIC_BASE_URL` is already present and reused for absolute URL
rewrites (page links, file attachment URLs).

## Testing

### Unit (vitest, `apps/web/test/server/page-export/`)

- `tiptap-to-html.spec.ts` — golden tests per extension (paragraph, headings,
  lists, taskList, blockquote, codeBlock with language, table, image, hr,
  callout with emoji, toggle expanded, hiddenText mark, fileAttachment,
  pageLink). One full-document snapshot.
- `embed-images.spec.ts` — `/api/files/<id>` mocked through `@repo/storage`;
  data URI replacement; ignored data-URIs and external URLs; failure path
  (warn + unchanged); 30-image semaphore concurrency.
- `html-to-markdown.spec.ts` — port of any existing tests for `editor-to-
markdown.ts`; cover callout/toggle/hiddenText/fileAttachment.
- `html-to-pdf.spec.ts` — mock `fetch`; assert multipart fields including
  `paperWidth=8.27`, `printBackground=true`, body contains expected HTML;
  stream pass-through; map TimeoutError → `GotenbergTimeoutError`, 503 →
  `GotenbergUpstreamError`.
- `filename.spec.ts` — Cyrillic title, special characters, empty title,
  long (>100 chars) title; `contentDisposition` produces RFC 5987 syntax.

### Integration (vitest, `apps/web/test/api/export-route.spec.ts`)

Mock `prisma`, `getSession`, `assertWorkspaceMember`, and `htmlToPdf`. Drive
the route handler with `NextRequest` instances and assert the `Response`:

- Happy paths: html / md / pdf each return 200, correct `Content-Type`,
  RFC 5987-encoded filename in `Content-Disposition`.
- 302 to `/sign-in` for null session.
- 403 for non-member.
- 404 for non-existent / `EXCALIDRAW` / `deletedAt` / wrong workspace.
- 200 with title-only body when `page.content === null`.
- Invalid format → 404. Invalid UUID → 404.
- Gotenberg timeout → 504. Gotenberg 503 → 502.

### E2E (Playwright, `apps/e2e/page-export.spec.ts`)

Requires `docker compose up -d` (now including `gotenberg`).

1. `signUpAndAuthAs(page, ...)` per the existing helper.
2. Create workspace, create a TEXT page, type a title, two paragraphs, one
   callout via the slash menu.
3. Open page actions menu → Экспортировать.
4. For each format:
   a. Click the button.
   b. Use `page.waitForEvent('download')` to capture the file.
   c. Assert:
   - PDF: file starts with `%PDF-` magic bytes; size > 1 KB.
   - HTML: contains `<title>${title}</title>`; contains the typed
     paragraph text; contains `<style>` with our print stylesheet
     markers; contains no `<script>` or `prosemirror`-prefixed classes.
   - MD: contains `# ${title}`; contains the typed paragraph text;
     callout rendered as `> 💡 ...`.
5. Empty-content edge case: create a page, do not type, export each format;
   each succeeds and contains the title.

The E2E spec uses `signUpAndAuthAs` rather than the auto-signed-in cookie
(memory note: the auto cookie does not survive the email-verification DB
update).

### Out of test scope

- Pixel-level PDF visual regression (font rendering varies by OS).
- Gotenberg performance / load tests.
- Concurrency / semaphore behavior beyond functional correctness in unit
  tests.

## Risks and mitigations

| Risk                                                                                                                                 | Mitigation                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@repo/editor` extensions tied to browser globals (window, Yjs) at module load → server-side `generateHTML` crashes.                 | Implementation phase audits each extension. If found, add `@repo/editor/extensions/server` subpath that exports schema-only nodes / marks. Fallback: duplicate schema definitions in `apps/web/src/server/page-export/server-extensions.ts`. |
| `@tiptap/html` SSR DOM (zeed-dom) emits HTML that diverges from `editor.getHTML()` on the client → snapshot tests catch divergences. | Golden-test corpus from current client output captured during implementation; any diff is a bug to fix before merge.                                                                                                                         |
| Pages with very large `Page.content` (10k+ blocks) make Gotenberg or `embedImages` slow.                                             | Synchronous flow with 30 s timeout. If real users hit it, follow-up adds async generation. Spec accepts the limit.                                                                                                                           |
| `Page.content` snapshot stale by one Hocuspocus debounce window when user types and immediately exports.                             | Documented and accepted. Future iteration may add Yjs decoding.                                                                                                                                                                              |
| Gotenberg crash on malformed HTML or pathological CSS.                                                                               | Tiptap controls the HTML; print stylesheet is fixed. Risk is low, but `htmlToPdf` errors are mapped to 5xx so users get a clear failure rather than a hang.                                                                                  |
| Production Gotenberg accidentally exposed to the public internet → open PDF relay / SSRF.                                            | Spec hard-requires private endpoint. DevOps deploy story explicitly captures this; deployment review must check it.                                                                                                                          |
| Storage fetch latency for image embedding bottlenecks small documents with many images.                                              | Semaphore (limit 8 concurrent) prevents pool exhaustion; per-image error is non-fatal.                                                                                                                                                       |

## Migration

No data migration. New code paths and a new docker service. Existing
client-side export functions are deleted in the same PR, so the dialog never
exists in a half-migrated state.

Sequencing within the PR:

1. Add Gotenberg to `compose.yml` and document env.
2. Land `assertWorkspaceMember` extraction with no behavior change.
3. Implement server-side serializer modules with unit tests.
4. Implement route handler with integration tests.
5. Replace dialog client logic; delete `lib/editor-to-markdown.ts`.
6. Add E2E spec.
7. Run `pnpm gates`.

## Follow-ups (not in this iteration)

- Excalidraw → PNG/SVG export via `@excalidraw/utils` headless renderer.
- Genogram export.
- Async generation with persistent S3 result and signed share URL.
- Production observability: `pdf_export_duration_seconds` histogram,
  `pdf_export_total{format,status}` counter.
- PDF page numbers / headers / footers via Gotenberg `headerHtml` /
  `footerHtml` if a user need surfaces.
- "Export current selection" or "export subtree" UX.
