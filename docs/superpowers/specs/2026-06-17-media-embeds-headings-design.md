# Media Blocks, Embeds/Bookmarks, Collapsible Headings (Phase 9B)

**Date:** 2026-06-17
**Status:** approved design (brainstorm decisions locked with the user)
**Roadmap source:** `cl9.md` Prompt 9.2 sub-steps 2,3,4 — sub-phase 2 of 6
(9A pwa+appearance ✓ → **9B media/embeds/headings** → 9C tabs+synced → 9D inline AI → 9E meetings → 9F dashboards).

Three bounded editor additions: video/audio media blocks with inline players,
embeds + bookmarks (provider allowlist + sanitizer + SSRF-guarded server-side
preview fetch), and collapsible headings (local per-viewer state). All built on
the existing Tiptap node + schema/server-split + slash/paste patterns.

## 1. Locked decisions

| Decision | Choice |
| --- | --- |
| Media upload | New `media` upload kind (video/* + audio/*, 200 MB cap, magic-byte container sniff, workspace-quota-counted, NOT public). Inline `<video controls>`/`<audio controls>` NodeViews. The 50 MB attachment kind is untouched. |
| Bookmark/embed metadata | Server-side preview fetch behind `assertSafeWebhookUrl` (https-only, private/metadata ranges blocked, redirect re-check) + size/time caps + a provider context. Embeds use a strict host allowlist; bookmark previews fetch og:title/description/image for any safe https URL. |
| Collapse state | LOCAL per-viewer: a ProseMirror decoration plugin hides a heading's following section; collapsed-heading keys live in localStorage keyed by pageId, NEVER in Yjs. No schema change to headings. |

## 2. Data model

NO Prisma schema changes for media (files already exist; the node attrs hold
`{url, name, size, mimeType}`). NO models for embeds/bookmarks (Yjs nodes with
attrs). The bookmark-preview fetch is stateless (no caching table in the MVP —
the node stores the fetched title/description/image at insert time).

Upload kinds (`apps/web/src/lib/file-validation.ts`): add `media`:
- `MEDIA_MAX_BYTES = 200 * 1024 * 1024`.
- `MEDIA_MIME`: `video/mp4`, `video/webm`, `video/ogg`, `video/quicktime`,
  `audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/webm`, `audio/mp4`.
- `isPublic: false`, `workspaceId: <active>` (attachment semantics — served
  auth-gated via `/api/files/[id]`, quota-counted). The upload route's magic-byte
  sniffer (`sniffImageMime` from 9A) gains container signatures:
  `sniffMediaMime` (ftyp box for mp4/mov/m4a, `1A45DFA3` webm/mkv, `OggS` ogg,
  `ID3`/`FFFB`/`FFF3` mp3, `RIFF....WAVE` wav). Mismatch ⇒ 400.

## 3. Editor: media blocks (`packages/editor/src/extensions/`)

- `video.schema.ts` + `video.tsx`, `audio.schema.ts` + `audio.tsx` — the
  ResizableImage/FileAttachment pattern: attrs `{url, name, size, mimeType,
  uploadId(rendered:false)}`; schema-only variants registered in `server.ts`
  (export renders a download link for video/audio — `<video>` doesn't belong in
  a PDF). NodeViews: `NodeViewWrapper` → `<video controls preload="metadata">` /
  `<audio controls>` over `/api/files/<id>`; empty-state placeholder (drop/click
  → upload) like ResizableImage; hover toolbar (replace/download/delete; NO
  resize for audio, optional width for video). Caption optional (reuse the image
  caption attr pattern if cheap; else skip).
- `file-upload.ts` routing: branch on `inferKind` — `video`→video node,
  `audio`→audio node, `image`→(existing image-paste path), else→fileAttachment.
  The upload handler must target `kind=media` for video/audio (the app's
  `createUploadHandler` chooses the kind by the blob's MIME — extend it).
- Slash items: `/video` («Видео», media group → openMediaUpload popover with the
  media file input), `/audio` («Аудио»). The FileUploadPopover pattern
  parametrised by accepted MIME + kind.
- `convert attachment↔video`: a node-toolbar action «Воспроизвести как видео» on
  a fileAttachment whose mimeType is video/* → swaps to the video node keeping
  url/name/size/mimeType (and the reverse «Показать как файл»). Pure node-type
  swap.

## 4. Editor: embeds & bookmarks

- `bookmark.schema.ts`+`.tsx`, `embed.schema.ts`+`.tsx` — atom nodes.
  Bookmark attrs `{url, title, description, image, favicon}`; embed attrs
  `{url, provider, embedUrl}`. Server export: bookmark → a titled link card
  (HTML/PDF-safe); embed → a link to the original (no iframe in export).
- **Provider allowlist + sanitizer** (`packages/editor/src/embed-providers.ts`,
  PURE + unit-tested): `EMBED_PROVIDERS` = host-pattern → `toEmbedUrl(url)`
  transformer for youtube/youtu.be, vimeo, rutube, vk video, dailymotion,
  loom, figma, codepen, soundcloud, google maps (a tight, documented list).
  `resolveEmbed(url)` → `{provider, embedUrl} | null`. The embed NodeView renders
  a sandboxed `<iframe src={embedUrl} sandbox="allow-scripts allow-same-origin
  allow-popups allow-presentation" loading="lazy">` — embedUrl is ALWAYS a
  provider-transformed URL (never the raw pasted URL), so no arbitrary-origin
  iframe. The bookmark/embed URL passes `normalizeLinkHref` (existing sanitizer:
  rejects javascript:/data:/vbscript:).
- **Bookmark preview fetch**: `POST /api/bookmark/preview` (the plantuml-render
  route shape: `runtime='nodejs'`, session-gated, zod `{url}`): `assertSafeWebhookUrl(url, lookup)` BEFORE the fetch (https-only, private/loopback/link-local/CGN/metadata blocked); fetch with `redirect:'manual'` (3xx → re-assert the Location host or fail — the sso-port precedent), `AbortSignal.timeout(8s)`, a 512KB body cap (read as a bounded stream), parse `<title>`/`og:title`/`og:description`/`og:image`/favicon from the FIRST 512KB only; sanitize the extracted image/favicon URLs (https-only, else dropped); return `{title, description, image, favicon}` (all optional, all length-capped). The image is rendered browser-side `<img>` (never server-fetched again). Rate-thinking: a tiny in-memory per-IP limiter (the /api/sso/resolve precedent).
- **Paste-URL menu** (`url-paste.ts`, the image-paste plugin pattern,
  priority below image-paste): pasting a bare URL onto an empty selection shows
  an inline chooser — «Ссылка» (plain link, default), «Закладка» (bookmark →
  insert node + async preview fetch fills attrs), «Встроить» (embed, only when
  resolveEmbed(url) ≠ null). Pasting onto a text selection stays a plain link
  (today's behavior). Slash items: `/bookmark` («Закладка» → URL input popover),
  `/embed` («Встроить» → URL input; rejects non-allowlisted with an honest note).
- **Doc-level rich-embed toggle** (cl9 line 157): a per-page editor preference
  «Показывать встраивания» (default on) stored in localStorage keyed by pageId —
  when off, embeds render as bookmark-style cards (no iframe). LOCAL, like the
  collapse state (no Yjs/schema). A toolbar/menu toggle exposes it.

## 5. Editor: collapsible headings

- `collapsible-headings.ts` — a ProseMirror plugin (NO schema change; headings
  stay stock StarterKit): each heading gets a derived stable key (the existing
  block-anchor/BlockIndexAttributes id — verify it's stable across edits; if not,
  derive from the heading's text + ordinal with a documented caveat). A decoration
  adds a ▸/▾ toggle widget before each heading; clicking toggles the key in a
  plugin-state Set mirrored to localStorage `anynote:collapsed:<pageId>`.
  Collapsed ⇒ a decoration hides every node from after the heading until the next
  same-or-higher-level heading (compute the section range; hidden via
  `display:none` decoration, NOT deletion — content stays in the doc/Yjs intact).
- Local per-viewer: another collaborator never sees your collapse; reload
  restores from localStorage; a brand-new viewer sees everything expanded.
- Keyboard/a11y: the toggle widget is a real `<button aria-expanded>`; collapsed
  sections are `aria-hidden`. Document the limitation: collapse is a view aid,
  not document structure.

## 6. App wiring

- `createUploadHandler` (apps/web): choose `kind` by blob MIME (image→attachment
  [unchanged, images stay attachment], video/audio→media, else→attachment) —
  OR add a `kindFor(mime)` helper. The editor's uploadHandler stays one function;
  the kind is internal.
- `page-renderer.tsx`: pass the new slash handlers (openMediaUpload,
  openBookmark, openEmbed) + the bookmark-preview fetch fn (a thin
  `fetch('/api/bookmark/preview')` wrapper) into `buildExtensions`/the editor.
- The `server.ts` schema set gains video/audio/bookmark/embed schema variants so
  PDF/HTML export renders sane fallbacks (verify the export route picks them up).

## 7. Security invariants (test-pinned)

1. Embeds NEVER render an arbitrary-origin iframe: the src is always a
   provider-allowlist-transformed embedUrl; a non-allowlisted URL cannot become
   an embed (resolveEmbed returns null → the /embed path refuses, the paste menu
   hides «Встроить»). Pinned with a table of allow/deny URLs.
2. The bookmark-preview route is SSRF-safe: private/loopback/link-local/metadata
   targets refused BEFORE fetch; redirects re-checked; body/time-capped; the
   extracted image/favicon URLs https-sanitized. Reuse + extend the webhooks
   ssrf tests (injectable lookup); a redirect-to-private case pinned.
2b. Bookmark/embed URLs pass `normalizeLinkHref` — javascript:/data: rejected
    (unit pinned).
3. Media upload: only the MEDIA_MIME set, magic-byte verified (an HTML payload
   as video/mp4 ⇒ 400); 200MB cap; quota-counted (413 on exceed); NOT public
   (auth-gated download).
4. Collapse state never enters Yjs/the document: a collapsed heading's content
   is present in the serialized doc (pinned — collapse is display-only); a second
   editor session sees its own collapse state.
5. Server export renders fallbacks (no `<video>`/`<iframe>` in PDF; bookmark →
   link card) — the schema/server-split is complete (the export route smoke).

## 8. Testing

- Editor unit (`pnpm --filter @repo/editor test`): the embed-provider allowlist
  matrix (allow youtube/vimeo/rutube/…, deny evil.com/raw-iframe/javascript:),
  `resolveEmbed` URL transforms, the sanitizer pass-through, `inferKind` media
  routing, the media-MIME validator, the section-range computer for collapsible
  headings, the collapse-state localStorage round-trip (pure helper), the
  bookmark-preview HTML parser (extract og tags from a fixture string, cap
  lengths).
- Web/route: `/api/files/upload?kind=media` validation (MIME + magic bytes +
  200MB + quota); `/api/bookmark/preview` (SSRF refusal via injectable lookup,
  redirect-to-private, the happy parse, the rate limit) — the files-route /
  sso-resolve test idioms.
- E2E (`media-embeds.spec.ts`, the editor-slash-media.spec pattern; NO yjs
  server so assert in-session): `/video` upload → `<video src^="/api/files/">`
  visible; `/audio` → `<audio>`; paste a youtube URL → the embed chooser →
  «Встроить» → an iframe with the youtube embed host; paste a plain article URL
  → «Закладка» → a bookmark card with a title (mock the preview route? — the
  route is real; use a stable public URL like example.com whose preview is
  deterministic, OR stub via a test-only fixture — prefer asserting the card
  renders + the url, title best-effort); collapsible heading: add an h2 with
  content below, click the collapse toggle → the content hides → expand → shows;
  the rich-embed doc toggle hides the iframe.
- Full gates + forced sweep; changelog «Видео, аудио, встраивания и
  сворачиваемые заголовки».

## 9. Non-goals

- Video transcoding/thumbnails/streaming (raw file served; browser-native
  playback only); audio waveforms.
- oEmbed/iframe for arbitrary providers (strict allowlist only); link unfurl on
  hover; link-mention (the `@`-page-mention exists; URL→mention is deferred).
- Bookmark preview caching/refresh (fetched once at insert); periodic re-fetch.
- Collapsing into a persisted/Yjs structure (local-only by decision);
  cross-device collapse sync.
- Converting between embed↔bookmark after insert (re-paste to change); embed
  resize.
