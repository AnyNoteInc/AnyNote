# Meetings / Transcription MVP (Phase 9E) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload an audio/video recording → transcribe through apps/agents → summarize + extract action items (workspace AI provider) → a MEETING page with summary, action items, and segment search; plus an embeddable MeetingNotesBlock. Async (6A job mold), consent-gated, plan-gated, S3-freeing on delete.

**Architecture:** A new `MEETING` Page.type owns a `MeetingArtifact` (the job aggregate, driven by its own `status`). An in-web runner kicks two service-token calls into apps/agents: `/transcription` (S3-reading, mock-or-real adapter) then `/meeting/summarize` (workspace AI provider via `ModelFactory`). UI clones the DATABASE page-type + import-wizard dialog + synced-block embed precedents.

**Tech Stack:** Prisma 7 (shared-dev-DB diff→psql→resolve), Next.js 16 route handlers, FastAPI + Dishka + LangChain (apps/agents), @aws-sdk/lib-storage (agents S3), Tiptap v3, MUI v6, vitest + pytest + Playwright.

**Spec:** `docs/superpowers/specs/2026-06-19-meetings-transcription-design.md` (read it; §§3–7 normative).

**Conventions (all tasks):** prettier `semi:false`/single-quotes/100-col (TS); ruff/black for Python (match apps/agents style). NEVER `git add -A` — stage explicit paths. Editor package = Bundler resolution, no tRPC/web deps. MUI via `@repo/ui/components` in app code. TDD for pure logic + the agents adapters + the tRPC gating. After each task: format the touched files. **Worktree hygiene:** if a target file shows as foreign-dirtied (` M`), `git checkout HEAD -- <file>` before editing; verify each commit lists only your files.

---

## Task 1: Schema — 4 models + MEETING Page.type + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260619120000_meetings/migration.sql`
- Test: (verified by Prisma generate + the `\d` checks; behavior tested in later tasks)

- [ ] **Step 1: Add the enum + models to schema.prisma**

Add `enum MeetingStatus { UPLOADED TRANSCRIBING SUMMARIZING READY FAILED }`. Add `MEETING` to the `PageType` enum. Add the four models EXACTLY as in spec §3 (`MeetingArtifact` with `heartbeatAt`, `TranscriptSegment`, `ActionItem`, `SummaryInstruction`). Add back-relations: `Page.meeting MeetingArtifact? @relation("PageMeeting")`, `File` → `@relation("MeetingRecording")` back-relation `meetingRecordings MeetingArtifact[]`, `Workspace.meetingArtifacts`/`summaryInstructions`, `User.meetingArtifacts` (relation "MeetingCreator") + summaryInstructions creator if modeled. Verify every named relation has both sides.

- [ ] **Step 2: Generate the migration (shared-DB flow, NO migrate dev / reset)**

```bash
cd /Users/victor/.config/superpowers/worktrees/anynote/notion-phase-9e-meetings
git show HEAD:packages/db/prisma/schema.prisma > /tmp/9e_old.prisma
mkdir -p packages/db/prisma/migrations/20260619120000_meetings
pnpm --filter @repo/db exec prisma migrate diff --from-schema /tmp/9e_old.prisma --to-schema packages/db/prisma/schema.prisma --script > packages/db/prisma/migrations/20260619120000_meetings/migration.sql
```
Strip any leaked dotenv banner lines so migration.sql is pure SQL (Read it; delete non-SQL lines).

- [ ] **Step 3: Apply + record + generate**

```bash
docker exec -i anynote-postgres-1 psql -U user -d anynote --single-transaction -v ON_ERROR_STOP=1 < packages/db/prisma/migrations/20260619120000_meetings/migration.sql
pnpm --filter @repo/db exec prisma migrate resolve --applied 20260619120000_meetings
pnpm --filter @repo/db prisma:generate
docker exec -i anynote-postgres-1 psql -U user -d anynote -c "\d meeting_artifacts" | grep -E "status|recording_file_id|page_id|heartbeat_at|consent_ack"
docker exec -i anynote-postgres-1 psql -U user -d anynote -c "\dt" | grep -E "transcript_segments|action_items|summary_instructions|meeting_artifacts"
```
Expected: meeting_artifacts has the columns + FKs (recording→File RESTRICT, page→Page CASCADE, workspace→Workspace CASCADE); the 3 child tables exist.

- [ ] **Step 4: check-types + commit**

```bash
pnpm --filter @repo/db check-types && pnpm check-types
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260619120000_meetings/migration.sql
git commit -m "feat(db): meeting models — MeetingArtifact/TranscriptSegment/ActionItem/SummaryInstruction + MEETING page type"
```

---

## Task 2: apps/agents — S3 client + /transcription + /meeting/summarize (mock-or-real, service-token)

**Files:**
- Modify: `apps/agents/agents/settings.py` (S3 fields)
- Create: `apps/agents/agents/apps/transcription/{__init__.py,router.py,schemas.py,depends.py}`
- Create: `apps/agents/agents/apps/transcription/repositories/{__init__.py,transcription_factory.py,s3_storage.py}`
- Create: `apps/agents/agents/apps/transcription/use_cases/{__init__.py,transcribe.py,summarize.py}`
- Modify: `apps/agents/agents/router.py` (register routes) + the DI container (register TranscriptionProvider)
- Test: `apps/agents/tests/test_transcription.py` (or the repo's pytest layout — match existing test dirs)

Read first: `apps/agents/agents/apps/validation/router.py` (service-token endpoint shape + `verify_agents_service_token`), `apps/agents/agents/apps/agent/use_cases/validate_provider.py` (the one-shot `make()`+`ainvoke` pattern), `apps/agents/agents/apps/agent/repositories/model_factory.py` (`ModelFactoryRepository.make` + `ModelConfigSchema`), `apps/agents/agents/apps/processing/depends.py` (the Provider + factory-selected-from-payload pattern = the mock-vs-real precedent), `apps/agents/agents/router.py` (`apply_routes`), `apps/agents/agents/settings.py`, an existing pytest file for the test style + how the dishka container is built in tests. Note the memory: `fast_clean` pydantic-settings only populates declared `SettingsSchema` fields (so S3 creds MUST be declared fields); `make()` must be INSIDE try/except.

- [ ] **Step 1: S3 settings fields**

Add to `SettingsSchema` (settings.py): `s3_endpoint: str | None`, `s3_region: str = 'us-east-1'`, `s3_access_key: str | None`, `s3_secret_key: str | None`, `s3_bucket: str | None` (env names matching web's `S3_ENDPOINT` etc. via fast_clean's env mapping — confirm the env-prefix convention; the existing `agents_jwt_secret` maps from `AGENTS_JWT_SECRET`, so `s3_endpoint`→`S3_ENDPOINT`). These are read by the S3 storage repo.

- [ ] **Step 2: S3 storage repo + transcription factory (TDD the factory selection + the mock)**

Write `test_transcription.py` first (pytest, mock the LLM + S3):
```python
# - the transcription factory returns MockTranscriptionAdapter for provider='mock'
# - MockTranscriptionAdapter.transcribe(key, mime) returns deterministic segments
#   [{idx,start_ms,end_ms,text}] WITHOUT touching real S3 (mock ignores/stubs the key)
# - the factory raises for an unknown provider
# - SummarizeUseCase: given a transcript + instruction, builds the model via a mocked
#   factory and returns {summary, action_items} parsed from a mocked ainvoke
# - make() error is caught → a clean error result, not an unhandled exception
```
Run pytest → FAIL.

Implement: `s3_storage.py` (`S3StorageRepository` using `aioboto3`/`boto3`+`@aws-sdk`-equiv — check what's already a python dep; if none, use `aioboto3` or `boto3`, add to pyproject via `uv`), `get_bytes(key) -> bytes`. `transcription_factory.py`: a `TranscriptionAdapter` Protocol (`async transcribe(audio_bytes|key, mime) -> TranscriptResult`), `MockTranscriptionAdapter` (deterministic segments; does NOT require real audio — derives N segments from a fixed canned script, optionally seeded by file size so it's stable), a `RealTranscriptionAdapter` stub (raises `NotImplemented`/reads config — never invoked in CI), and `TranscriptionFactory.make(provider)` matching on provider (mock|<real-name>). Run → mock + factory tests green.

- [ ] **Step 3: use_cases + schemas**

`schemas.py`: `TranscribeRequestSchema { workspace_id, recording_s3_key, mime_type, provider, language? }`, `TranscriptSegmentSchema {idx,start_ms,end_ms,speaker?,text}`, `TranscribeResponseSchema {segments, language?, duration_ms?}`; `SummarizeRequestSchema { model: ModelConfigSchema, transcript: str, summary_instruction: str | None }`, `SummarizeResponseSchema {summary, action_items: list[str]}`. `use_cases/transcribe.py`: read bytes via S3 repo (skip for mock), run the adapter, return segments. `use_cases/summarize.py`: `model_factory.make(config)` INSIDE try/except, `ainvoke` a summary+action-item prompt, parse the structured output (instruct the model to return a JSON `{summary, action_items}`; parse defensively). Run the summarize test → green.

- [ ] **Step 4: router + DI + registration**

`router.py`: `POST /transcription` + `POST /meeting/summarize`, both `Depends(verify_agents_service_token)`, validate `wsid`-vs-request where applicable (the validation router precedent), call the use-cases. `depends.py`: `TranscriptionProvider(Provider)` providing the S3 repo (Scope.APP), the factory, the use-cases. Register in `agents/router.py apply_routes` + add the provider to the container. Add a router-level test (service-token guard rejects a bad token; `/transcription` with provider=mock returns segments).

- [ ] **Step 5: verify + commit**

```bash
pnpm --filter agents test    # or: cd apps/agents && uv run pytest -m "not integration"
pnpm --filter agents check-types 2>/dev/null || (cd apps/agents && uv run pyright 2>/dev/null) || true
```
(Run the agents test the repo's way — check package.json `agents` scripts.) Commit:
```bash
git add apps/agents/agents/settings.py apps/agents/agents/apps/transcription apps/agents/agents/router.py <container-file> apps/agents/tests/test_transcription.py <pyproject-if-dep-added>
git commit -m "feat(agents): /transcription (S3-reading, mock-or-real adapter) + /meeting/summarize (workspace provider)"
```

---

## Task 3: meetingsEnabled plan flag + the in-web meeting-client + job runner

**Files:**
- Modify: `packages/domain/src/billing/dto/billing.dto.ts` (+ `meetingsEnabled` on PlanFeatures), `packages/domain/src/billing/repositories/billing.repository.ts` (parse from `Plan.features` JSON), `packages/db/prisma/seed.ts` (enable on paid tiers)
- Create: `apps/web/src/lib/agents/meeting-client.ts` (service-token POST helpers)
- Create: `apps/web/src/server/jobs/process-meeting-job.ts` (the runner)
- Modify: `packages/trpc/src/trpc.ts` (add `'meeting'` to `JobRunnerPort` kind), `apps/web/src/server/jobs/kick.ts` (dispatch)
- Test: `apps/web/test/meeting-job.test.ts`, a billing dto/repo test extension

Read first: `packages/domain/src/billing/{dto/billing.dto.ts,repositories/billing.repository.ts}` (planToFeatures + the `publicSites`/`pageHistory` JSON-array-derived flag precedent), `packages/db/prisma/seed.ts` (plan features arrays), `apps/web/src/lib/chat/provider-connection.ts` + `apps/web/src/app/api/ai/inline/handler.ts` (the 9D provider resolution to reuse for summarize), `apps/web/src/lib/agents-token.ts` / `packages/trpc/src/helpers/agents-token.ts` (`signAgentsServiceToken`), `packages/trpc/src/helpers/agents-validate.ts` (`postValidate` helper mold), `apps/web/src/server/jobs/{process-import-job.ts,kick.ts}` + `packages/trpc/src/trpc.ts` (JobRunnerPort).

- [ ] **Step 1: meetingsEnabled flag (TDD)**

Add `meetingsEnabled: boolean` to `PlanFeatures` (billing.dto.ts). In billing.repository.ts `planToFeatures`, derive it from the `Plan.features` JSON array (mirror how `publicSites` is parsed). Update seed.ts: add `'meetings'` to the pro + max `features` arrays (NOT personal — paid-tier framing per spec §5). Extend the billing repo/dto test: a plan with `'meetings'` in features → `meetingsEnabled: true`; without → false. Run → green.

- [ ] **Step 2: meeting-client.ts (the service-token POST helpers)**

`createTranscription(args)` and `summarizeMeeting(args)`: sign a service token (`signAgentsServiceToken({userId, workspaceId})`), POST `${AGENTS_SERVICE_URL}/transcription` resp. `/meeting/summarize` with the body, `AbortSignal.timeout(...)`, parse the typed response, throw a sanitized error on non-OK (mirror `agents-validate.ts postValidate`). Export for the runner. (No test here — covered by the runner test with a mocked fetch.)

- [ ] **Step 3: the job runner (TDD with mocked agents fetch + prisma)**

Write `meeting-job.test.ts` first:
```ts
// processMeetingJob(artifactId, {prisma, fetch, resolveProvider}):
// - claims UPLOADED → TRANSCRIBING (updateMany count 0 → early return, idempotent)
// - calls /transcription, writes TranscriptSegment rows, sets SUMMARIZING
// - resolves the workspace provider (400/abort if no defaultModel → status FAILED with a clear error)
// - calls /meeting/summarize, writes summary + ActionItem rows, sets READY
// - agents error at any step → FAILED + sanitized error
// - heartbeatAt bumped between phases
```
Run → FAIL.

Implement `process-meeting-job.ts` (the process-import-job mold): atomic claim, the two meeting-client calls, write segments/summary/action-items, status transitions, heartbeat, try/catch → FAILED with sanitized error. Inject deps (prisma, the meeting-client fns, the provider resolver) so it's testable. Run → green.

- [ ] **Step 4: wire the JobRunnerPort kind + kick dispatch**

Add `'meeting'` to the `JobRunnerPort['kick']` kind union (trpc.ts). In `kick.ts`, add the `'meeting'` case → dynamic-import + call `processMeetingJob`. Run the editor/trpc check-types.

- [ ] **Step 5: verify + commit**

```bash
pnpm --filter @repo/domain test && pnpm --filter web test meeting-job && pnpm --filter @repo/domain check-types && pnpm --filter web check-types && pnpm check-types
git add packages/domain/src/billing apps/web/src/lib/agents/meeting-client.ts apps/web/src/server/jobs/process-meeting-job.ts packages/trpc/src/trpc.ts apps/web/src/server/jobs/kick.ts packages/db/prisma/seed.ts apps/web/test/meeting-job.test.ts <billing-test>
git commit -m "feat(web): meeting job runner — transcribe→summarize pipeline, meetingsEnabled plan gate, service-token agents client"
```

---

## Task 4: the meeting tRPC router (create/read/list/search/delete/instructions) + S3-freeing delete

**Files:**
- Create: `packages/trpc/src/routers/meeting.ts`
- Modify: `packages/trpc/src/index.ts` (register)
- Modify: the page hard-delete path so MEETING-page delete frees the recording S3 (route through meeting delete) — `packages/domain/src/pages/repositories/pages.repository.ts` and/or the trpc page delete
- Test: `packages/trpc/test/meeting-router.test.ts` (real-DB, fixture-scoped)

Read first: `packages/trpc/src/routers/synced-block.ts` (the typed-union object-hiding `getById`, the access helpers, create/list/delete + idempotency — the closest analogue), `packages/trpc/src/routers/page.ts` (`create` via `domainSvc.pages.create`, `assertWorkspaceMember`/`requireWritableWorkspace`), `packages/trpc/src/helpers/{page-access.ts,plan.ts}`, `apps/web` storage usage for the delete (how a route gets the `@repo/storage` client — the file delete in the MCP tool `apps/engines/.../file.tools.ts:238` for the S3-first ordering; in trpc, import the storage singleton), the page hard-delete tx from 9D Task 1 work (`hardDeletePageTx`/`emptyTrashTx`).

- [ ] **Step 1: the router skeleton + create (TDD)**

Write `meeting-router.test.ts` first (fixture-scoped real-DB):
```ts
// meeting.create({workspaceId, recordingFileId, consentAck:false}) → 400 (consent required)
// meeting.create(consentAck:true) → creates MEETING Page + MeetingArtifact(status UPLOADED) + kicks job (assert ctx.jobs.kick called with 'meeting'); plan-gated (meetingsEnabled off → 403)
// meeting.getByPage / getById → object-hiding for a non-member (no_access), full for a member
// meeting.list → workspace-scoped
// meeting.delete → storage.delete(recording.path) called (mock storage) + rows gone; idempotent
// summary instructions: create/list workspace-scoped
```
Run → FAIL.

- [ ] **Step 2: implement meeting.ts**

Procedures: `create` (assert member + `requireWritableWorkspace` + `getWorkspaceFeatures().meetingsEnabled` 403-gate + **require consentAck** 400 + verify the recordingFile belongs to the workspace + create the MEETING Page (via `domainSvc.pages.create` or a direct create with type MEETING) + the MeetingArtifact linked to the page + `ctx.jobs.kick(artifact.id, 'meeting')`; return `{ pageId, artifactId }`). `getByPage`/`getById` (typed union `{status:'ok'|'processing'|'failed'|'no_access'|'not_found', ...}`, object-hiding via the page-access check). `list`. `searchSegments` (optional server-side; or rely on client filter — implement a simple server `searchSegments({meetingId, q})` returning matching segments, access-gated). `delete` (access-gate; `storage.delete(recording.path)` S3-first, then delete the artifact + File row; idempotent). `setSummaryInstruction`/`createSummaryInstruction`/`listSummaryInstructions` (workspace-scoped). Register in index.ts. Run → green.

- [ ] **Step 3: route MEETING-page delete through the S3-freeing path**

Ensure that hard-deleting a MEETING page frees the recording S3 object. Decisive approach (spec §5): the page hard-delete tx cascades the artifact rows (FK), but the S3 object must be freed by the web layer. Add: when a MEETING page is hard-deleted via the page trpc/domain path, look up its artifact's recording File and `storage.delete` it (in the trpc page-delete mutation wrapper, NOT in domain). If the page-delete goes purely through domain, add a post-delete S3 cleanup in the trpc layer that runs before/after the domain call using the artifact's recording path captured pre-delete. Add a test: hard-deleting a MEETING page calls storage.delete for the recording. (Keep it minimal + correct; the FK cascade handles the DB rows.)

- [ ] **Step 4: verify + commit**

```bash
pnpm --filter @repo/trpc test meeting-router && pnpm --filter @repo/trpc test && pnpm --filter @repo/trpc check-types && pnpm check-types
git add packages/trpc/src/routers/meeting.ts packages/trpc/src/index.ts packages/trpc/test/meeting-router.test.ts <page-delete-files>
git commit -m "feat(trpc): meeting router — consent-gated create, object-hiding reads, S3-freeing delete, summary instructions"
```

---

## Task 5: MEETING page-type wiring + MeetingTranscriptPage + MeetingUploadDialog + TranscriptSearchPanel

**Files:**
- Create: `apps/web/src/components/meeting/{MeetingTranscriptPage.tsx,MeetingUploadDialog.tsx,TranscriptSearchPanel.tsx}`
- Modify: `apps/web/src/components/page/page-renderer.tsx` (MEETING case), `apps/web/src/app/(protected)/(active)/pages/[pageId]/page.tsx` (isFullBleed), `apps/web/src/components/templates/page-type-registry.tsx` (icon/label, NOT creatable grid)
- Where the upload dialog is launched (a sidebar/create entry that opens MeetingUploadDialog) — find the create-page entry + add a «Запись встречи»/«Загрузить встречу» action
- Test: a pure test for the TranscriptSearchPanel filter if extracted; otherwise E2E (Task 7)

Read first: `apps/web/src/components/database/database-page-renderer.tsx` (the tRPC-loaded full-page renderer with spinner/repair fallback — the MeetingTranscriptPage template), `apps/web/src/components/page/page-renderer.tsx` (the DATABASE dispatch case + dynamic import), `pages/[pageId]/page.tsx` (isFullBleed list), `page-type-registry.tsx` (pageTypeIcon/Label + the CREATABLE list — add MEETING to icon/label maps but NOT to the creatable grid, the FORM precedent), `apps/web/src/components/import-export/import-wizard-dialog.tsx` (the Dialog + hidden-file-input + upload→tRPC-mutation flow — the MeetingUploadDialog template), `apps/web/src/app/onboarding/consents/consents-form.tsx` (the required-checkbox-with-linked-copy consent pattern), `apps/web/src/components/search/{search-dialog.tsx,highlight-matches.tsx}` (the InputBase+debounce+List+HighlightMatches primitives for TranscriptSearchPanel), `apps/web/src/lib/upload-handler.ts` + `/api/files/upload` (upload as kind=media).

- [ ] **Step 1: MEETING page-type dispatch**

In `page-renderer.tsx` add `if (page.type === 'MEETING') return <MeetingTranscriptPage pageId={page.id} editable={editable}/>` (dynamic import ssr:false). Add MEETING to `isFullBleed` in `pages/[pageId]/page.tsx`. Add MEETING to `pageTypeIcon`/`pageTypeLabel` in page-type-registry.tsx (a mic/meeting icon, label «Встреча») but do NOT add it to `CREATABLE_PAGE_TYPES`.

- [ ] **Step 2: MeetingTranscriptPage**

Clone database-page-renderer: `trpc.meeting.getByPage.useQuery({pageId})` with a refetch poll while status is processing (`refetchInterval` until READY/FAILED — the progress-poll). Render: a status banner (UPLOADED/TRANSCRIBING/SUMMARIZING spinner + label; FAILED → the error + a «Повторить» that re-kicks via a `meeting.retry` mutation OR re-create; READY → the content). READY content: the summary (render markdown), the action-item checklist (`meeting.toggleActionItem` if interactive, else read-only list), the transcript segment list (timestamps mm:ss + speaker + text, each with an id for scroll-to), and `<TranscriptSearchPanel segments={…}/>`. Handle no_access/not_found gracefully.

- [ ] **Step 3: MeetingUploadDialog**

Clone import-wizard-dialog: a MUI Dialog with a hidden file input (`accept="audio/*,video/*"`), the picked filename, a **required consent checkbox** (consents-form pattern; distinct `data-testid="meeting-consent-checkbox"`; copy discloses recording/transcription + obtaining participant consent), a summary-instruction `<Select>` («Авто» default + the workspace `SummaryInstruction`s via `trpc.meeting.listSummaryInstructions` + a «Своя инструкция» free-text option that creates one). Confirm (disabled until file && consent): upload the file via `/api/files/upload?kind=media` → `{file:{id}}` → `trpc.meeting.create.mutateAsync({workspaceId, recordingFileId, consentAck:true, summaryInstructionId?|customInstruction?})` → navigate to `/pages/{pageId}`. Surface 403 (plan) / 413 (quota) errors cleanly.

- [ ] **Step 4: TranscriptSearchPanel**

A client-side filter over the in-memory `segments` prop: a debounced `InputBase`, a `List` of matching segments rendered with `<HighlightMatches text query>`, clicking scrolls to the segment (ref/hash). No tRPC roundtrip. If a pure filter helper is extractable (`filterSegments(segments, q)`), put it in a `.ts` and unit-test it.

- [ ] **Step 5: launch entry**

Find the create-page entry point (the sidebar «Новая страница» / the create flow). Add a «Загрузить встречу» action that opens `<MeetingUploadDialog>` (gated on `meetingsEnabled` — hide/disable if the plan lacks it). Keep it discoverable but out of the generic page-type grid.

- [ ] **Step 6: verify + commit**

```bash
pnpm --filter web check-types && pnpm --filter web lint
set -a && source /Users/victor/Projects/anynote/.env; set +a && pnpm --filter web build   # FOREGROUND
pnpm format apps/web/src/components/meeting/*.tsx apps/web/src/components/page/page-renderer.tsx <others>
git add apps/web/src/components/meeting apps/web/src/components/page/page-renderer.tsx "apps/web/src/app/(protected)/(active)/pages/[pageId]/page.tsx" apps/web/src/components/templates/page-type-registry.tsx <launch-entry-file>
git commit -m "feat(web): MEETING page type — transcript page, upload dialog (consent + summary instruction), segment search"
```

---

## Task 6: MeetingNotesBlock (editor atom node + embed + injection thread)

**Files:**
- Create: `packages/editor/src/extensions/meeting-notes-block.ts` (+ `.schema.ts` if the split is used) + `.test.ts`
- Modify: `packages/editor/src/{types.ts,extensions/index.ts,extensions/server.ts,slash-items.ts,anynote-editor.tsx}`, `apps/web/src/server/page-export/server-extensions.ts`
- Create: `apps/web/src/components/meeting/meeting-block-embed.tsx`
- Modify: `apps/web/src/components/page/page-renderer.tsx` (render-prop + the slash launch)

Read first: `packages/editor/src/extensions/synced-block.tsx` + `synced-block.schema.ts` (the atom-node + render-prop + ReactNodeViewRenderer pattern — the EXACT template), `apps/web/src/components/page/synced-block-embed.tsx` (the tRPC-loaded object-hiding switch embed), the 9C/9D injection thread (types.ts → buildExtensions → configure → anynote-editor storage → page-renderer closure), `slash-items.ts` (the gated-when-handler-wired item, the synced-block item at the embedding group), `apps/web/src/server/page-export/server-extensions.ts` (register the schema for export — server renderHTML = a labeled link, never live).

- [ ] **Step 1: the node + schema (TDD pure)**

`meeting-notes-block.ts`: an atom node (group block, atom, draggable, `contentEditable=false`) with attr `meetingArtifactId`. Server renderHTML = a labeled card («Запись встречи») + a link, NEVER live. `MeetingNotesBlockOptions { renderMeetingBlock, onNavigateToPage }` + the render-prop call in the NodeView (fallback placeholder when unconfigured). Pure test (`.test.ts`): attr round-trip + the server fallback render. Run RED→GREEN.

- [ ] **Step 2: registration + injection types + slash item**

Register in `extensions/index.ts` (client), `extensions/server.ts` + `apps/web/.../server-extensions.ts` (schema for export). Add `renderMeetingBlock` to `BuildExtensionsOptions` + `AnyNoteEditorProps` (types.ts) threaded through buildExtensions → `MeetingNotesBlock.configure({renderMeetingBlock})`. Add a gated slash item «Запись встречи» (embedding group, included only when `handlers.openMeetingPicker` wired) that opens the upload dialog (or picks an existing artifact).

- [ ] **Step 3: meeting-block-embed.tsx + page-renderer wiring**

`meeting-block-embed.tsx`: `trpc.meeting.getById.useQuery({id: meetingArtifactId})`, switch on the typed status union (`processing`→spinner card, `ready`→compact summary card + «Открыть встречу» link to the MEETING page, `failed`→error card, `no_access`/`not_found`→placeholder). In `page-renderer.tsx`, add the `renderMeetingBlock` closure (mirror renderSyncedBlock) + wire the slash `openMeetingPicker` (opens MeetingUploadDialog from Task 5, or an existing-artifact picker). Pass to `<AnyNoteEditor>`, editable-gated.

- [ ] **Step 4: verify + commit**

```bash
pnpm --filter @repo/editor test meeting && pnpm --filter @repo/editor check-types && pnpm --filter @repo/editor lint && pnpm --filter web check-types && pnpm --filter web lint
set -a && source /Users/victor/Projects/anynote/.env; set +a && pnpm --filter web build   # FOREGROUND
pnpm format <touched files>
git add packages/editor/src/extensions/meeting-notes-block.ts packages/editor/src/extensions/meeting-notes-block.test.ts packages/editor/src/types.ts packages/editor/src/extensions/index.ts packages/editor/src/extensions/server.ts packages/editor/src/slash-items.ts packages/editor/src/anynote-editor.tsx apps/web/src/server/page-export/server-extensions.ts apps/web/src/components/meeting/meeting-block-embed.tsx apps/web/src/components/page/page-renderer.tsx
git commit -m "feat(editor): MeetingNotesBlock — atom node, object-hiding embed, slash + render-prop injection"
```

---

## Task 7: E2E + changelog + deploy env vars

**Files:**
- Create: `apps/e2e/meetings.spec.ts`
- Modify: `docs/changelog.md`
- Modify: `.env.example`, `turbo.json` (globalEnv), `deploy/.env.template` + `.github/workflows/deploy.yml` (the agents S3 vars, if newly required for the agents container)

Read first: `apps/e2e/helpers/auth.ts`, `apps/e2e/create-page-from-chat-banya.spec.ts` (seeding WorkspaceAiSettings.defaultModel + a plan), an editor/media E2E for the file-input + in-session assertion pattern, the 9B tiny media fixtures (36-byte mp4 / 74-byte mp3 — grep apps/e2e/fixtures), the E2E constraints (no yjs server; `--retries`; `el.evaluate(e=>e.click())` for overlays; `rm -rf apps/web/.next` if wedged), `.env.example` + `turbo.json` globalEnv + `deploy/.env.template` + `.github/workflows/deploy.yml` (the new-env-var pipeline — apps/agents now needs S3 creds; confirm whether the agents container already gets S3_* or they must be added to its env block).

- [ ] **Step 1: deploy env vars**

The agents S3 creds are NEW required vars for the agents container. Add `S3_ENDPOINT/S3_REGION/S3_ACCESS_KEY/S3_SECRET_KEY/S3_BUCKET` (the names the agents SettingsSchema reads) to: `.env.example` (if not already present for web — agents shares the root .env locally), `turbo.json globalEnv` (so cache tracks them), `deploy/.env.template`, the `deploy.yml` agents-service env block, and note the GitHub secret requirement. (Web already has S3_* — confirm; the new surface is the AGENTS container env block needing them.) Commit this separately or with the E2E.

- [ ] **Step 2: meetings.spec.ts**

`signUpAndAuthAs` → seed via Prisma: a plan with `meetings` in features (or set the workspace's plan), `WorkspaceAiSettings.defaultModel` (a provider+model). Mock the agents calls — but note: the runner calls agents server-side from the web process, so `page.route` (browser) won't intercept it. Instead, either (a) mock at the agents-service boundary via the E2E agents-validation-server pattern (extend `apps/e2e/mocks/` with a fake `/transcription` + `/meeting/summarize` responder wired by `AGENTS_SERVICE_URL`), OR (b) seed a READY MeetingArtifact + segments + summary directly via Prisma and assert the MeetingTranscriptPage renders them (the dominant chat-E2E seed-and-assert pattern — simpler, deterministic). PREFER (b) for the page-render assertions + (a) only if testing the live upload→processing flow. Tests: (1) seed a READY artifact + MEETING page → open it → summary + action items + a transcript segment render; TranscriptSearchPanel filters to a matching segment. (2) the upload dialog: open it, assert the consent checkbox blocks submit until checked (in-session, no need to complete the real pipeline). (3) no-consent → blocked. (4) plan-off → the upload entry is hidden/disabled.

- [ ] **Step 3: run the spec (docker up, retries)**

```bash
docker compose up -d
cd /Users/victor/.config/superpowers/worktrees/anynote/notion-phase-9e-meetings
set -a && source /Users/victor/Projects/anynote/.env; set +a
pnpm exec playwright test apps/e2e/meetings.spec.ts --retries=2 --reporter=line
```
`rm -rf apps/web/.next` if wedged. Treat only deterministic attempt-2+ failures as real; fix minimal real causes (reset foreign-dirtied files first).

- [ ] **Step 4: changelog + commit**

`docs/changelog.md`: a Phase 9E entry — meeting notes: upload a recording, get a transcript + summary + action items, with consent + your workspace AI provider. HONEST scope: uploaded recordings only (no live capture/calendar/desktop), mock transcription by default. Commit:
```bash
pnpm format apps/e2e/meetings.spec.ts docs/changelog.md
git add apps/e2e/meetings.spec.ts docs/changelog.md .env.example turbo.json deploy/.env.template .github/workflows/deploy.yml
git commit -m "test(e2e): meetings — transcript render, consent gate, search

docs(changelog): phase 9e meetings; chore(deploy): agents S3 env vars"
```

---

## Self-review notes (plan author)

- **Spec coverage:** §3 models → T1; §4 pipeline (agents endpoints + runner) → T2+T3; §5 storage/billing (plan flag, quota reuse, S3-freeing delete) → T3(flag)+T4(delete); §6 UI (page type, dialog, search, block) → T5+T6; §7 invariants distributed (consent T4, object-hiding T4/T6, provider-resolution T3, mock-only-in-CI T2/T7, service-token T2, S3-delete T4, plan-gate T3/T4, sanitized errors T3, deploy env T7); §8 tests in each task; §9 file structure matches; §10 honest limits → changelog T7.
- **Type consistency:** `MeetingStatus`/the artifact status drive the runner (T3) + the router union (T4) + the page UI (T5) + the block embed (T6) — the `getById` typed union (`ok|processing|failed|no_access|not_found`) is defined in T4 and consumed by T5/T6; finalize the exact union in T4 and honor it. `meetingsEnabled` (T3) gates T4 create + T5 launch + T6 slash. The agents `TranscribeResponseSchema`/`SummarizeResponseSchema` (T2) shapes are consumed by the meeting-client (T3).
- **Migration:** schema-to-schema diff, no reset; `\d` verification.
- **Group review** after T4 (schema + agents + runner + router — the security/data core) + a final whole-branch review after T7. The consent-required, object-hiding access, provider-no-global, S3-freeing-delete, and no-live-provider-in-CI invariants get adversarial attention in the final review.
- **agents S3 is genuinely new** (settings.py confirmed has no S3) → T2 adds the SettingsSchema fields + T7 the deploy pipeline; the dev script may need `--env-file` (the fast_clean memory).
