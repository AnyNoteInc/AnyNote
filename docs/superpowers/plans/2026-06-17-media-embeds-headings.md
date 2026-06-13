# Media, Embeds/Bookmarks, Collapsible Headings Implementation Plan (Phase 9B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Video/audio media blocks, embeds + bookmarks (provider allowlist + SSRF-guarded preview), and local-state collapsible headings — per `docs/superpowers/specs/2026-06-17-media-embeds-headings-design.md` (THE SPEC; normative).

**Architecture:** All editor work follows the existing Tiptap patterns — the ResizableImage/FileAttachment node + schema/server-split, the image-paste plugin for paste menus, slash-items + FileUploadPopover for insertion, the @repo/webhooks SSRF guard for the bookmark route, ProseMirror decorations + localStorage for collapse.

**Template files:** `packages/editor/src/extensions/{resizable-image.tsx,file-attachment.schema.ts,file-attachment.tsx,image-paste.ts,file-upload.ts,index.ts,server.ts}`, `packages/editor/src/{slash-items.ts,link-href.ts,anynote-editor.tsx}`, `packages/editor/src/components/file-upload-popover.tsx`, `apps/web/src/lib/{upload-handler.ts,file-validation.ts}`, `apps/web/src/app/api/{files/upload/route.ts,plantuml/render/route.ts,sso/resolve/route.ts}`, `packages/webhooks/src/ssrf.ts`, `apps/e2e/editor-slash-media.spec.ts`.

**Test discipline:** editor unit tests are PURE (no DB); route tests use injectable lookup/fetch (the ssrf/sso idioms); E2E asserts in-session (NO yjs server — content doesn't survive reload). Run editor suites alone.

**Commits:** explicit paths, NEVER `git add -A`.

---

## Task 1: Media upload kind + magic-byte sniff

**Files:** Modify `apps/web/src/lib/file-validation.ts` (+`media` kind, MEDIA_MIME, MEDIA_MAX_BYTES, sniffMediaMime), `apps/web/src/app/api/files/upload/route.ts` (the media kind branch + media sniff), `apps/web/src/lib/upload-handler.ts` (kindFor(mime) → media for video/audio); tests in `apps/web/test/`.

- [ ] **Step 1 (TDD):** `media` kind: MEDIA_MAX_BYTES 200MB, MEDIA_MIME (the spec §2 list), isPublic false + workspaceId active (attachment semantics); `sniffMediaMime(bytes)` — container signatures (ftyp mp4/mov/m4a, 1A45DFA3 webm, OggS ogg, ID3/FFFB/FFF3 mp3, RIFF…WAVE wav) returning the family ('video'/'audio') or null; the route validates sniff-family vs the declared MIME family (a video/* declared must sniff video-ish; reject HTML-as-mp4). Extend `apps/web/test/api/files-upload-kinds.test.ts` (the 9A home): media MIME accepted, HTML-as-mp4 ⇒ 400, >200MB ⇒ 413/400, quota-counted (unlike icon/cover — verify it goes through the workspace quota aggregate path like attachment).
- [ ] **Step 2:** `kindFor(mime)` in upload-handler.ts (video/* | audio/* → 'media', image stays 'attachment' per the image-paste flow [images already go attachment], else 'attachment'); the editor's createUploadHandler chooses kind internally.
- [ ] **Step 3:** `pnpm --filter web test && pnpm --filter web check-types`. **Step 4 — commit:**
```bash
git add apps/web/src/lib/file-validation.ts apps/web/src/app/api/files/upload/route.ts apps/web/src/lib/upload-handler.ts apps/web/test
git commit -m "feat(media): media upload kind — video/audio MIME, 200MB cap, magic-byte sniff"
```

---

## Task 2: Video + audio editor blocks

**Files:** Create `packages/editor/src/extensions/{video.schema.ts,video.tsx,audio.schema.ts,audio.tsx}`; Modify `packages/editor/src/extensions/{index.ts,server.ts,file-upload.ts}`, `packages/editor/src/slash-items.ts`, `packages/editor/src/anynote-editor.tsx` (the media popover), `packages/editor/src/components/file-upload-popover.tsx` (parametrise accepted MIME/kind if reused, else a MediaUploadPopover); Create `packages/editor/test/video.test.ts` (pure: parseHTML/renderHTML round-trip, the inferKind routing).

- [ ] **Step 1:** the schema files (Node.create, attrs {url,name,size,mimeType,uploadId rendered:false}, parseHTML from `video`/`audio` tags + a data-attr, renderHTML to the same) registered in server.ts (server render = a download link, NO `<video>` in export); the .tsx NodeViews (ReactNodeViewRenderer; `<video controls preload=metadata>` / `<audio controls>` over node.attrs.url; empty-state click/drop → openMediaUpload; hover toolbar replace/download/delete; video optional width). Mirror resizable-image.tsx structure exactly (the uploadId transient-attr re-find for async upload).
- [ ] **Step 2:** file-upload.ts routes inferKind video→video node, audio→audio node (insert via the same deleteRange+insertContent pattern); slash `/video`,`/audio` (media group) → openMediaUpload (accepted MIME = MEDIA_MIME, kind via the handler); the convert action «Воспроизвести как видео» on a video-mime fileAttachment + the reverse (node-type swap keeping attrs).
- [ ] **Step 3:** `pnpm --filter @repo/editor test && pnpm --filter @repo/editor check-types && pnpm --filter @repo/editor lint && pnpm --filter web build` (the editor compiles through web). **Step 4 — commit:**
```bash
git add packages/editor/src/extensions packages/editor/src/slash-items.ts packages/editor/src/anynote-editor.tsx packages/editor/src/components packages/editor/test
git commit -m "feat(editor): video and audio blocks with inline players and attachment conversion"
```

---

## Task 3: Embed provider allowlist + bookmark/embed nodes + paste menu

**Files:** Create `packages/editor/src/embed-providers.ts` (+`embed-providers.test.ts`), `packages/editor/src/extensions/{bookmark.schema.ts,bookmark.tsx,embed.schema.ts,embed.tsx,url-paste.ts}`; Modify `index.ts`, `server.ts`, `slash-items.ts`, `anynote-editor.tsx` (the bookmark/embed popovers + the preview-fetch injection), `link-href.ts` if a shared sanitizer helper is extracted.

- [ ] **Step 1 (TDD, pure):** `embed-providers.ts` — EMBED_PROVIDERS (host patterns + toEmbedUrl) for the spec §4 list; `resolveEmbed(url): {provider, embedUrl} | null` (transforms watch URLs to embed URLs; returns null for non-allowlisted); the allowlist matrix test (allow youtube/youtu.be/vimeo/rutube/vk/dailymotion/loom/figma/codepen/soundcloud/gmaps with the right embedUrl; deny evil.com, a raw iframe URL, javascript:). The embed src is ALWAYS embedUrl (never the raw URL).
- [ ] **Step 2:** the nodes — bookmark {url,title,description,image,favicon} (NodeView = a card: favicon+title+description+host, click opens url; async-fillable attrs), embed {url,provider,embedUrl} (NodeView = sandboxed `<iframe src=embedUrl sandbox="allow-scripts allow-same-origin allow-popups allow-presentation" loading=lazy>`; respects the doc-level rich-embed toggle — off ⇒ render as a bookmark-style card). Server schema variants (bookmark→link card, embed→original link). URL passes normalizeLinkHref.
- [ ] **Step 3:** `url-paste.ts` (image-paste plugin pattern, lower priority): bare-URL paste on empty selection → an inline chooser «Ссылка»/«Закладка»/«Встроить» (the last only when resolveEmbed≠null); choosing Закладка inserts the node then calls the injected previewFetch to fill attrs; selection paste stays a link. Slash `/bookmark`,`/embed` (embedding group) → URL popovers (embed rejects non-allowlisted honestly).
- [ ] **Step 4:** the doc-level rich-embed toggle (localStorage `anynote:embeds:<pageId>`, default on) + a toggle control (editor menu or a small per-embed/global affordance — pick the lightest); the embed NodeView reads it.
- [ ] **Step 5:** `pnpm --filter @repo/editor test && check-types && lint`. **Step 6 — commit:**
```bash
git add packages/editor/src
git commit -m "feat(editor): embeds and bookmarks — provider allowlist, sandboxed iframes, paste menu"
```

---

## Task 4: Bookmark-preview route (SSRF-guarded)

**Files:** Create `apps/web/src/app/api/bookmark/preview/route.ts`, `apps/web/src/lib/bookmark-preview.ts` (the pure HTML→meta parser); Modify `apps/web/src/components/page/page-renderer.tsx` (inject the previewFetch fn into the editor); tests in `apps/web/test/`.

- [ ] **Step 1 (TDD pure):** `bookmark-preview.ts` parseMeta(html) → {title, description, image, favicon} extracting `<title>`, og:title/description/image, favicon link; all length-capped (title ≤200, desc ≤400, urls ≤1024); image/favicon sanitized https-only (else dropped). Unit-test against fixture HTML strings (og present, og absent → <title> fallback, malicious image url dropped, oversized truncated).
- [ ] **Step 2:** the route (plantuml-render shape: runtime nodejs, session-gated via getSession, zod {url}): `assertSafeWebhookUrl(url, lookup)` from @repo/webhooks BEFORE fetch; fetch redirect:'manual' + re-assert on 3xx Location (the sso-port precedent — if 3xx, validate the Location host with assertSafeWebhookUrl and follow once, else fail); AbortSignal.timeout(8s); read ≤512KB of the body (bounded ReadableStream read, not res.text() unbounded); parseMeta over that; an in-memory per-IP rate limit (the /api/sso/resolve sliding window). Returns {title?,description?,image?,favicon?} or empty on any failure (never error-leaks the target). Tests (the files-route/sso-resolve idioms, injectable lookup + fetchFn): SSRF refusal (private lookup ⇒ 200 empty or 400 — pick + pin, no fetch happened), redirect-to-private refused, happy parse, oversized body capped, rate-limited 429.
- [ ] **Step 3:** page-renderer injects `bookmarkPreview = (url) => fetch('/api/bookmark/preview',...).then(...)` into the editor's buildExtensions (the url-paste/bookmark insert path calls it).
- [ ] **Step 4:** `pnpm --filter web test && check-types && lint`. **Step 5 — commit:**
```bash
git add apps/web/src/app/api/bookmark apps/web/src/lib/bookmark-preview.ts apps/web/src/components/page/page-renderer.tsx apps/web/test
git commit -m "feat(web): bookmark-preview route — ssrf-guarded og-metadata fetch with caps"
```

---

## Task 5: Collapsible headings (local decoration)

**Files:** Create `packages/editor/src/extensions/collapsible-headings.ts` (+`collapsible-headings.test.ts` for the pure helpers); Modify `index.ts`, `anynote-editor.tsx` (pass pageId for the localStorage key).

- [ ] **Step 1 (TDD pure):** the section-range computer — given the doc and a heading pos, return the range [after-heading, next-same-or-higher-heading) (unit-tested with a fixture doc structure: h2 then paragraphs then h2; h1 then h2 then content; trailing heading). The collapse-key derivation (the block-anchor id — verify stable; else text+ordinal with a comment) and the localStorage round-trip (`anynote:collapsed:<pageId>` Set serialization).
- [ ] **Step 2:** the plugin: decorations add a `<button aria-expanded>` ▸/▾ widget before each heading; plugin state holds the collapsed-key Set (init from localStorage, persist on toggle); collapsed ⇒ `display:none` node decorations over the section range (content stays in the doc — NEVER deleted, NEVER touches Yjs); collapsed sections aria-hidden. The plugin takes pageId (for the storage key) via the extension options.
- [ ] **Step 3:** wire into index.ts/anynote-editor (pageId option threads from page-renderer). `pnpm --filter @repo/editor test && check-types && lint && pnpm --filter web build`. **Step 4 — commit:**
```bash
git add packages/editor/src/extensions/collapsible-headings.ts packages/editor/src/extensions/index.ts packages/editor/src/anynote-editor.tsx packages/editor/test apps/web/src/components/page/page-renderer.tsx
git commit -m "feat(editor): collapsible headings — local per-viewer section folding via decorations"
```

---

## Task 6: E2E + changelog

**Files:** Create `apps/e2e/media-embeds.spec.ts`; Modify `docs/changelog.md`.

- [ ] **Step 1 — E2E** (editor-slash-media.spec pattern; NO yjs server — assert in-session; a small mp4/mp3 fixture in apps/e2e/fixtures): `/video` upload [setInputFiles a tiny mp4] → `video[src^="/api/files/"]` visible; `/audio` → `audio`; paste a youtube URL into an empty line → the chooser appears → click «Встроить» → `iframe[src*="youtube"]`; paste a plain https URL → «Закладка» → a bookmark card with the url (title best-effort — the preview route is real; use example.com or stub; assert the card + url render, not the exact title); a non-allowlisted URL → «Встроить» absent from the chooser; collapsible heading: insert an h2 + a paragraph below → click the heading's collapse toggle → the paragraph hidden → toggle → shown. Tiny binary fixtures committed.
- [ ] **Step 2 — changelog** («Готовится»):
```md
**Видео, аудио, встраивания и сворачиваемые заголовки**

- Загружайте видео и аудио прямо в страницу со встроенным плеером; вставляйте ссылки как закладки с превью или как встраивания (YouTube, Vimeo, RuTube и другие — по списку разрешённых).
- Сворачивайте разделы под заголовками — по одному клику, только у вас (не мешая соавторам).
```
- [ ] **Step 3:** run (FOREGROUND, retries, 3100 free, .next wipe if a build preceded). **Step 4 — commits:**
```bash
git add apps/e2e/media-embeds.spec.ts apps/e2e/fixtures && git commit -m "test(e2e): video/audio blocks, embed/bookmark paste, collapsible headings"
git add docs/changelog.md && git commit -m "docs(changelog): media, embeds, collapsible headings"
```

---

## Completion

Group reviews: Tasks 1–3 (upload+media+embeds) then 4–6 (route+collapse+E2E). Final whole-branch review foci: (1) the embed iframe safety — src is ALWAYS a provider-transformed allowlist URL, sandbox attrs present, no path from a raw/pasted URL to an arbitrary-origin iframe (adversarial: a youtube-lookalike host? the host-pattern strictness); (2) the bookmark-preview SSRF — refusal before fetch, redirect re-check, body/time/rate caps, no target-error leak, the extracted-image sanitization; (3) media upload — magic-byte family match, the 200MB+quota enforcement, not-public/auth-gated; (4) collapse never touches the doc/Yjs (serialized doc has the content; per-viewer); (5) regression — the existing image/file/paste flows untouched (image-paste priority, the attachment path), server export renders the new nodes' fallbacks, no editor-mount/collab spec breakage. Then full gates + the forced uncached sweep + the merge checkpoint.

## Self-review (at plan-writing time)

- Spec §2→T1; §3→T2; §4→T3 (nodes/allowlist/paste) + T4 (preview route); §5→T5; §6→T2/T3/T4/T5 wiring; §7 invariants pinned across T1-T5 + final; §8→per-task + T6.
- Type consistency: kindFor (T1) used by the editor uploadHandler (T2); resolveEmbed (T3) consumed by embed node + url-paste + slash; parseMeta (T4) by the route; the section-range computer (T5) by the plugin; the previewFetch injection (T4) by url-paste/bookmark (T3) — NOTE ordering: T3 builds the bookmark insert that CALLS previewFetch, T4 provides it; T3's bookmark works with a no-op/undefined previewFetch until T4 wires it (build T3 tolerant of an absent fetch fn).
- Known risks named in-task: the block-anchor id stability (T5.1), the bounded-body stream read (T4.2), the youtube-lookalike host strictness (T3.1 + final review), the E2E preview determinism (T6.1).
