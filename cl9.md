# Editor, AI, PWA, meetings, dashboards

## Описание фазы

Эта фаза closes remaining product polish gaps by aligning AnyNote with current
Notion behavior where it is public/documented: richer editor blocks, inline AI,
meeting notes, charts/dashboard views, and cross-device app expectations.
PWA install is AnyNote deployment-specific, not a direct Notion primitive, but
it should feel consistent with Notion's desktop/web/mobile app expectations.

## Полный ожидаемый результат

- PWA manifest and install prompt are visible, with honest browser/install/offline
  messaging. Do not present PWA as Notion parity; use it as AnyNote's app-shell
  delivery path.
- Editor supports Notion-aligned page icon/cover, media blocks, embeds/bookmarks,
  collapsible headings, tabs and synced blocks or a scoped first implementation.
- Inline AI actions work from selection/block/empty line and can stream
  accepted/retried/discarded suggestions while using AnyNote workspace AI provider
  settings.
- Meeting upload creates transcript, summary and action items through mocked/real
  agents pipeline, with consent and summary-instruction UX modeled after Notion AI
  Meeting Notes where feasible.
- Dashboards are database-backed views/widgets with charts, table/board/calendar
  style widgets where available, global filters, edit/view modes, and permission
  behavior matching the underlying database/view.
- Plan gates, permissions and storage limits are enforced.

## Scope и ограничения

This phase touches broad surfaces. Keep each sub-feature bounded and testable.
Do not connect live paid transcription providers in tests. Dashboards depend on
generic databases and must respect database permissions, row/page access rules,
property visibility and structure-editing permissions. AI must use
local/controlled LLM and embedding provider connections configured per
workspace; do not copy Notion AI's proprietary behavior or hard-code Notion's
vendors.

Official Notion alignment sources to consult before implementation:

- https://www.notion.com/help/synced-blocks
- https://www.notion.com/en-gb/help/embed-and-connect-other-apps
- https://www.notion.com/help/images-files-and-media
- https://www.notion.com/help/guides/page-icons-and-covers
- https://www.notion.com/en-gb/releases/2026-03-30
- https://www.notion.com/help/notion-ai-faqs
- https://www.notion.com/help/notion-agent
- https://www.notion.com/help/research-mode
- https://www.notion.com/help/ai-meeting-notes
- https://www.notion.com/help/charts
- https://www.notion.com/help/dashboards
- https://www.notion.com/help/use-pages-offline
- https://www.notion.com/help/notion-for-desktop
- https://www.notion.com/help/notion-for-mobile
- https://www.notion.com/help/public-pages-and-web-publishing

## Рабочее задание фазы

Цель: закрыть remaining product polish by matching documented Notion behaviors:
synced blocks, media/embeds/bookmarks, icon/cover, tabs, inline AI/AI blocks,
meeting notes/transcription, chart/dashboard database views, and app install
expectations.

Зависимости: PWA может идти отдельно. Dashboards зависят от databases Phase 3/4.
Inline AI и meeting summaries зависят от workspace AI settings already present.
Offline editing beyond shell/app caching is a separate scoped decision unless
explicitly implemented.

## Prompt 9.1 - PWA install experience

```text
Цель: добавить видимый AnyNote install flow as an app-shell convenience.
Notion itself documents separate desktop/mobile apps and offline pages in those
apps; AnyNote PWA is deployment-specific and should not be described as a direct
Notion feature clone.

Ориентиры по коду и текущей реализации:
- apps/web app structure
- existing service worker/push notification files
- next.js manifest support for current Next version
- Notion reference behavior: desktop app has tabs, command search and push;
  mobile app supports read/edit/comment on content; offline pages are available
  in desktop/mobile apps but not web browsers.

Сделай:
1. Add app manifest:
   - name AnyNote;
   - short_name;
   - icons;
   - theme/background colors.
2. Add install prompt handling:
   - `InstallAppButton`;
   - `InstallPromptBanner` where appropriate;
   - hide when unsupported/installed.
3. Add app/offline help page in settings or user menu:
   - explain installed PWA vs browser mode;
   - explain current offline scope honestly;
   - do not promise full offline page editing unless this prompt implements it.
4. Keep service worker scope conservative:
   - cache app shell/assets needed for launch;
   - avoid caching private workspace data unless there is an explicit encrypted
     offline storage design;
   - preserve existing push notification behavior.
5. Tests:
   - manifest route responds;
   - install button renders under mocked beforeinstallprompt;
   - no broken push notification behavior.
   - help copy does not imply unsupported offline/page sync behavior.

Проверки:
- pnpm --filter web lint
- pnpm check-types
- Playwright smoke for manifest/install UI if feasible

Критерий готовности:
- Users can discover installing AnyNote as an app, and the product is clear about
  what the installed experience does and does not support.
```

## Prompt 9.2 - editor blocks: synced blocks, video, embeds, covers, tabs

```text
Цель: добавить editor/content gaps against documented Notion behavior.

Ориентиры по коду и текущей реализации:
- packages/editor/src/extensions/**
- apps/web/src/components/page/**
- file upload/rendering components
- Notion reference behavior:
  - page icons and covers are first-class page appearance controls;
  - media blocks support image/file/audio/video, uploads, external URLs and
    resizing/replacement where feasible;
  - embeds/bookmarks/link mentions are distinct paste outcomes;
  - tabs split a page into sections via `/tabs`;
  - synced blocks have original/copy instances, cross-page edits, access checks,
    copy/unsync/unsync-all semantics.

Разбей реализацию на sub-steps in one branch:
1. Page icon and cover:
   - PageAppearance model/fields for icon and cover;
   - icon picker: emoji/icon/upload if existing asset pipeline supports it;
   - cover picker: upload, external image URL, and existing gallery/source if any;
   - AI-generated cover only if routed through AnyNote workspace AI settings and
     explicitly plan-gated;
   - render in page header and database row/card if database exists.
2. Media blocks:
   - upload video;
   - inline player;
   - external YouTube/Vimeo/RuTube or provider allowlist parser;
   - preserve attachment/file block fallback when a format cannot play inline;
   - convert attachment <-> video if feasible.
3. Embeds, bookmarks and link mentions:
   - provider allowlist/sanitizer;
   - paste URL menu: embed/bookmark/mention where feasible;
   - bookmark preview with title/description/url;
   - source/open-original action;
   - document-level rich embed toggle.
4. Collapsible headings:
   - collapse content under heading hierarchy;
   - persist local/editor state carefully.
5. Tabs block:
   - tab labels/order;
   - content per tab;
   - keyboard/accessibility.
6. Synced blocks:
   - if too large, create design doc first;
   - canonical content + instances;
   - visual boundary/instance indicator;
   - cross-page updates;
   - original page access enforcement;
   - copy, unsync one copy, unsync all, delete semantics;
   - include a safe rule for many copies instead of silently deleting remote
     instances.

Tests:
- Add unit tests for pure helpers.
- Add editor/package tests where possible.
- Add Playwright smoke for each user-visible block.
- Include permission tests for synced blocks and embed allowlist/sanitizer tests.

Проверки:
- pnpm --filter @repo/editor test
- pnpm --filter web lint
- pnpm check-types
- relevant Playwright editor specs

Критерий готовности:
- Editor additions are polished and don't destabilize existing text editor.
```

## Prompt 9.3 - inline AI inside editor

```text
Цель: добавить AI actions directly in Tiptap editor, aligned with Notion AI
inline/AI-block behavior while preserving AnyNote's provider model.

Ориентиры по коду и текущей реализации:
- apps/web/src/components/workspace/chat/**
- packages/trpc/src/routers/chat.ts / ai-settings.ts / ai-provider.ts
- apps/agents service contracts
- packages/editor integration points
- Notion reference behavior:
  - highlight text or press Space in an empty page/editor position to invoke AI;
  - actions include summary, translation, grammar/style, longer/shorter, new
    content, brainstorming, tables/outlines;
  - generated edits can be accepted, discarded or retried;
  - Agent can use page/block context and mentioned sources, and Research Mode can
    produce source-backed reports, but AnyNote must scope this to existing agents,
    permissions and local/controlled providers.

Сделай:
1. Add editor AI command surface:
   - selection/block menu "Спросить AI";
   - empty-line Space prompt;
   - `/AI Block` or equivalent AI block if it fits existing editor architecture;
   - preset actions: summarize, rewrite, grammar, translate, shorten, expand,
     continue, brainstorm, make table/outline.
2. Add backend endpoint:
   - uses workspace AI provider settings;
   - plan gates;
   - rate limits;
   - cancellation.
   - permission filter for page/block/database context before sending to agents.
3. Add streaming insertion:
   - undo-safe Tiptap transaction adapter;
   - accept/retry/discard toolbar.
4. Add audit:
   - model/provider/tokens/action/page.
5. Optional research/report mode stub:
   - only if it can reuse existing agents/RAG safely;
   - source list/citations from workspace search;
   - no web search unless explicitly configured and policy-gated.
6. Tests:
   - permission/plan gate;
   - preset action request shape;
   - insertion can be accepted/discarded.
   - selected-block context is filtered by permissions;
   - retry does not duplicate accepted content.

Проверки:
- pnpm --filter @repo/trpc test
- pnpm --filter web lint
- pnpm check-types
- Playwright inline AI with mocked agents response

Критерий готовности:
- AI feels native to editing, not only chat/RAG, and every request uses AnyNote
  workspace AI settings instead of a hidden global provider.
```

## Prompt 9.4 - meetings/transcription MVP

```text
Цель: реализовать MVP для meeting notes/transcription artifacts, modeled after
documented Notion AI Meeting Notes where feasible.

Ориентиры по коду и текущей реализации:
- apps/agents architecture
- file/storage package
- workspace AI provider settings
- Notion reference behavior:
  - AI Meeting Notes is a meeting block started from `/meet`;
  - app/browser capture differs: desktop app captures system audio + mic, browser
    is more limited;
  - users must disclose recording/transcription and obtain consent;
  - summaries can use built-in or custom instructions;
  - generated notes include transcript, key points/summary and action items.

Сделай:
1. Add models:
   - MeetingArtifact;
   - TranscriptSegment;
   - ActionItem.
   - SummaryInstruction or equivalent saved prompt/instruction reference.
2. Add UI:
   - MeetingUploadDialog;
   - MeetingTranscriptPage;
   - TranscriptSearchPanel.
   - MeetingNotesBlock or page block entry point if editor integration is
     practical;
   - consent copy before transcription starts or before uploaded recording is
     processed;
   - summary instruction selector with "Auto" and custom instruction option.
3. Add processing pipeline:
   - upload audio/video;
   - transcription adapter through agents;
   - summarization/action-item extraction.
   - clear state transitions: uploaded, transcribing, summarizing, ready, failed.
4. Add storage/billing policy:
   - size limits;
   - plan gates;
   - deletion.
5. Tests:
   - upload creates artifact;
   - mocked transcription stores segments;
   - summary/action items render.

Не делай:
- Не подключай live paid transcription provider in tests.
- Не обещай live meeting capture, system audio capture, calendar integration or
  desktop-app behavior unless implemented.
- Не копируй proprietary Notion AI summary behavior; use AnyNote's agents and
  workspace provider settings.

Проверки:
- pnpm --filter agents test
- pnpm --filter @repo/trpc test
- pnpm --filter web lint
- pnpm check-types

Критерий готовности:
- MVP supports uploaded recordings and generated transcript/summary/action items
  with explicit consent, storage, plan and provider boundaries.
```

## Prompt 9.5 - BI dashboards over databases

```text
Цель: добавить dashboard layer поверх generic databases, aligned with Notion
Dashboard view and Chart view behavior.

Ориентиры по коду и текущей реализации:
- database source/view models
- chart libraries already installed, if any
- apps/web UI patterns for work-focused dashboards
- Notion reference behavior:
  - dashboards are database views, not separate BI exports;
  - widgets display database views such as table/board/calendar/timeline/chart;
  - dashboards have edit mode vs view mode;
  - dashboards can include global filters across widgets/sources when properties
    match;
  - charts support vertical/horizontal bar, line, donut and number-style views;
  - dashboard permissions follow the underlying database.

Сделай:
1. Add models:
   - Dashboard;
   - DashboardWidget.
   - DashboardGlobalFilter if implementing global filters in MVP.
2. Add route/page:
   - dashboard list;
   - dashboard editor;
   - widget settings.
   - view mode vs edit mode.
3. Widget types MVP:
   - metric;
   - table;
   - bar/line chart if chart lib available;
   - donut/number chart if easy with the chosen chart lib;
   - grouped aggregation.
4. Query service:
   - source database/view;
   - aggregation;
   - grouping;
   - filters;
   - global filters across compatible widgets;
   - respects database access, page-level rules and property visibility.
5. Performance guardrails:
   - cap widgets per dashboard or per row;
   - avoid large unfiltered table widgets by default;
   - cache/query only what each widget needs.
6. Tests:
   - create dashboard;
   - add metric widget;
   - widget reads database rows;
   - hidden properties not available.
   - view-only user cannot edit layout;
   - global filter applies only to widgets with matching properties.

Проверки:
- pnpm --filter @repo/trpc test
- pnpm --filter web lint
- pnpm check-types
- Playwright dashboard smoke

Критерий готовности:
- Databases can power internal dashboards without exporting data, and dashboard
  access never exceeds the underlying database/view permissions.
```
