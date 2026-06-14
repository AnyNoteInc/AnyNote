# Phase 9E — Meetings / Transcription MVP — Design

**Status:** approved (design decisions locked via AskUserQuestion 2026-06-14)
**Roadmap:** cl9 Prompt 9.4 (`cl9.md:251-314`). Fifth of six cl9 sub-phases (9A✓ 9B✓ 9C✓ 9D✓ — this is 9E). 9F dashboards follows → roadmap complete.
**Branch:** `feat/notion-phase-9e-meetings` off `main@d25c322e`.

## 1. Goal

An MVP for **meeting notes / transcription artifacts**, modeled after documented Notion AI Meeting Notes where feasible, scoped to AnyNote's agents + workspace provider model: upload an audio/video recording → transcribe (through apps/agents) → summarize + extract action items (workspace AI provider) → a transcript page with summary, action items, and segment search. Explicit consent, storage, plan, and provider boundaries.

## 2. Scope (locked)

**In scope:**
- **Models:** `MeetingArtifact`, `TranscriptSegment`, `ActionItem`, `SummaryInstruction`.
- **Upload + consent:** a `MeetingUploadDialog` — pick an audio/video file (reuse the `media` upload kind, 200MB), a **required recording-disclosure consent checkbox**, and a summary-instruction selector («Авто» + saved/custom instruction).
- **Processing pipeline (async, 6A job infra):** upload → **transcribe through agents** (mock-or-real adapter) → **summarize + action-item extraction** (workspace AI provider) → state transitions `uploaded → transcribing → summarizing → ready → failed`.
- **agents S3 client:** apps/agents gains an S3/MinIO client; web passes the recording's S3 key; agents reads the bytes directly (no bytes-in-payload).
- **UI:** a new **`MEETING` Page.type** rendered by `MeetingTranscriptPage` (transcript + summary + action items + `TranscriptSearchPanel`); **a `MeetingNotesBlock`** editor atom node to embed a meeting inside a TEXT doc.
- **Storage/billing:** size limit (the existing 200MB media cap), a **new `meetingsEnabled` plan flag** (via `Plan.features` JSON), reuse the `WorkspaceLimit.maxFileBytes` aggregate quota, and an **explicit S3 deletion path** for the recording + artifact.

**Explicitly OUT of scope** (decided / готовность "Не делай"):
- **No live paid transcription provider in tests** — a mock adapter (selected by a payload `provider` field) is the default; a real adapter is wired but never exercised in CI.
- **No live meeting capture, system-audio capture, calendar integration, or desktop-app behavior** — uploaded recordings only. UI copy must not promise these.
- No copying proprietary Notion AI summary behavior — AnyNote's agents + workspace provider only.
- No recording cap raise (stay at 200MB; no streaming/presigned upload rework).
- No token quota (best-effort, same as 9D).

## 3. Data model

```prisma
enum MeetingStatus {
  UPLOADED      // recording stored, job queued
  TRANSCRIBING
  SUMMARIZING
  READY
  FAILED
}

model MeetingArtifact {
  id            String        @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId   String        @map("workspace_id") @db.Uuid
  pageId        String?       @map("page_id") @db.Uuid          // the MEETING page that owns this (null until linked)
  createdById   String        @map("created_by_id") @db.Uuid
  recordingFileId String      @map("recording_file_id") @db.Uuid // FK → File (the uploaded media)
  title         String        @default("Встреча")
  status        MeetingStatus @default(UPLOADED)
  summary       String?       @db.Text                          // generated summary (markdown)
  summaryInstructionId String? @map("summary_instruction_id") @db.Uuid
  consentAck    Boolean       @default(false) @map("consent_ack") // recording-disclosure acknowledged (server-persisted)
  error         String?       @db.Text
  durationMs    Int?          @map("duration_ms")
  language      String?                                          // detected/declared transcript language
  heartbeatAt   DateTime?     @map("heartbeat_at") @db.Timestamptz(6) // runner liveness for lazy reclaim (6A mold)
  createdAt     DateTime      @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt     DateTime      @updatedAt @map("updated_at") @db.Timestamptz(6)

  workspace   Workspace  @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  page        Page?      @relation("PageMeeting", fields: [pageId], references: [id], onDelete: Cascade)
  recording   File       @relation("MeetingRecording", fields: [recordingFileId], references: [id], onDelete: Restrict)
  createdBy   User       @relation("MeetingCreator", fields: [createdById], references: [id], onDelete: Cascade)
  summaryInstruction SummaryInstruction? @relation(fields: [summaryInstructionId], references: [id], onDelete: SetNull)
  segments    TranscriptSegment[]
  actionItems ActionItem[]

  @@index([workspaceId])
  @@index([pageId])
  @@map("meeting_artifacts")
}

model TranscriptSegment {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  meetingId   String   @map("meeting_id") @db.Uuid
  idx         Int                                  // ordinal within the transcript
  startMs     Int      @map("start_ms")
  endMs       Int      @map("end_ms")
  speaker     String?                              // optional speaker label
  text        String   @db.Text
  meeting MeetingArtifact @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  @@index([meetingId, idx])
  @@map("transcript_segments")
}

model ActionItem {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  meetingId   String   @map("meeting_id") @db.Uuid
  idx         Int
  text        String   @db.Text
  done        Boolean  @default(false)
  meeting MeetingArtifact @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  @@index([meetingId, idx])
  @@map("action_items")
}

model SummaryInstruction {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId String   @map("workspace_id") @db.Uuid
  name        String
  instruction String   @db.Text
  createdById String   @map("created_by_id") @db.Uuid
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  @@index([workspaceId])
  @@map("summary_instructions")
}
```

- `Page.type` enum gains `MEETING`; `Page` gets a `meeting MeetingArtifact? @relation("PageMeeting")` back-relation (1:1 — a MEETING page has one artifact). `File` gets the `MeetingRecording` back-relation. `Workspace`/`User` get the obvious back-relations.
- **The pipeline is driven by `MeetingArtifact.status` directly — NO separate `MeetingJob` table.** The artifact IS the job aggregate (simpler than a parallel Job model; the 6A import/export Job table was justified by artifacts/warnings the meeting artifact already carries inline). The runner reuses the 6A mechanics on the artifact row: atomic claim (`updateMany where status='UPLOADED'`), a `heartbeatAt` column on `MeetingArtifact` for liveness, and lazy reclaim (a `TRANSCRIBING`/`SUMMARIZING` artifact with `heartbeatAt < now-10min` is re-kicked once, or set `FAILED` after a second stall). Add `heartbeatAt DateTime?` to the model for this. No `stage` enum is needed — `TRANSCRIBING`/`SUMMARIZING` are already distinct `MeetingStatus` values that serve as the in-progress stages.
- Migration via the shared-DB diff→psql→resolve flow (Prisma 7 `--to-schema`; apply with `psql --single-transaction`; `migrate resolve --applied`).

## 4. Processing pipeline (async, 6A job infra)

The runner lives in apps/web (`apps/web/src/server/jobs/process-meeting-job.ts`, the 6A `process-import-job.ts` mold), kicked via the `JobRunnerPort` (`ctx.jobs.kick(artifactId, 'meeting')` — add `'meeting'` to the kind union). Steps:

1. **Atomic claim:** `meetingArtifact.updateMany({where:{id, status:'UPLOADED'}, data:{status:'TRANSCRIBING', updatedAt}})` returning early if count 0 (idempotent, deploy-safe).
2. **Transcribe:** sign a service token (`signAgentsServiceToken`), POST `AGENTS_SERVICE_URL + '/transcription'` with `{ workspaceId, recordingS3Key, mimeType, provider: <mock|real>, language? }`. Agents reads the bytes from S3, runs the adapter, returns `{ segments: [{idx,startMs,endMs,speaker?,text}], language, durationMs }`. Web writes the `TranscriptSegment` rows + sets `status='SUMMARIZING'`.
3. **Summarize:** resolve the workspace AI provider (the 9D `resolveProviderConnection` + `WorkspaceAiSettings.defaultModel`, **400/abort if no default**) and POST `AGENTS_SERVICE_URL + '/meeting/summarize'` with `{ model:{provider,name,connection,settings}, transcript, summaryInstruction }`. Agents builds the model via `ModelFactoryRepository.make` and does a one-shot `ainvoke` (the `validate_provider.py` pattern, `make()` INSIDE try/except) returning `{ summary, actionItems: string[] }`. Web writes `summary` + `ActionItem` rows + sets `status='READY'`.
4. **Failure:** any step error → `status='FAILED', error=<message>` (sanitized). The UI polls the artifact status (refetch loop on the page/embed, the 6A progress-poll precedent).

**agents `/transcription` + `/meeting/summarize`** (new, `apps/agents/agents/apps/transcription/`):
- Both gated by `verify_agents_service_token` (the internal-service tier — mirror `validation/router.py`).
- `/transcription`: a `TranscriptionAdapter` Protocol + `MockTranscriptionAdapter` (returns a deterministic canned/segmented transcript derived from the file — for dev/CI) + a real adapter; selected by the payload `provider` field (the `model_factory.make` match-on-provider precedent — NOT an env flag). The **S3 client** is a new Dishka-provided storage adapter (new `SettingsSchema` fields: `S3_ENDPOINT/REGION/ACCESS_KEY/SECRET_KEY/BUCKET` — same names as web's `@repo/storage`); the adapter reads the key. Tests use `provider="mock"` and never touch S3-real-or-paid-provider (the mock can accept the key and ignore it / read a tiny fixture).
- `/meeting/summarize`: reuses `ModelFactoryRepository.make` + a one-shot `ainvoke` with a summary+action-item prompt; returns structured `{summary, actionItems}`.

## 5. Storage / billing

- **Upload:** the recording uploads via the existing `/api/files/upload?kind=media` route (200MB, container-sniffed, quota-counted, auth-gated). `MeetingUploadDialog` does this (the import-wizard-dialog precedent), gets back `{file:{id}}`, then calls `meeting.create({ workspaceId, recordingFileId, consentAck, summaryInstructionId? })`.
- **Plan gate:** a **new `meetingsEnabled`** flag derived from the `Plan.features` JSON array (the `publicSites`/`pageHistory` precedent — no schema column on Plan; parsed in `billing.repository.ts planToFeatures`); added to `PlanFeatures` DTO. `meeting.create` + the upload + the agents calls all gate on `getWorkspaceFeatures(workspaceId).meetingsEnabled` (403 if off). Seed: enable for pro/max (and personal? — decided in plan; default enable on paid tiers only, matching the "AI feature" framing).
- **Quota:** the recording counts against `WorkspaceLimit.maxFileBytes` automatically (the upload route's aggregate check) — no new quota mechanism.
- **Deletion (the GAP — must close):** the recording's S3 object must be freed, not just the DB rows (copy the engines MCP `delete_file` S3-first ordering: `storage.delete(key)` then the DB rows). **Decisive MVP approach:** `meeting.delete` (tRPC, has the storage client) is the canonical deletion path — it `storage.delete(recording.path)` then deletes the artifact + its File row + cascaded segments/action-items. For the MEETING-**page** hard-delete (which runs in `@repo/domain`, no storage client), the domain layer cannot call S3; so the MEETING page delete is routed through the meeting tRPC layer: deleting a MEETING page first calls `meeting.delete` (web-side, frees S3) and then the page delete. The page hard-delete tx still cascades the artifact DB rows (FK Cascade) as a backstop, but the S3-freeing step is the tRPC `meeting.delete`. (This is the same "domain can't reach S3, so the web tRPC layer owns the S3 side-effect" boundary the project already lives with for files; the plan wires the MEETING-page delete to go through `meeting.delete` first.)

## 6. UI

- **`MEETING` Page.type** → `page-renderer.tsx` case → `<MeetingTranscriptPage pageId={…} editable={…}/>` (dynamic, ssr:false; the DATABASE renderer precedent). Loads via `trpc.meeting.getByPage`, shows: a status banner for non-READY states (UPLOADED/TRANSCRIBING/SUMMARIZING spinner; FAILED with the error + a retry), and for READY: the summary (markdown), the action-item checklist, the transcript (segment list with timestamps/speakers), and the `TranscriptSearchPanel`. Kept OUT of the generic `CREATABLE_PAGE_TYPES` grid (the FORM precedent) — a MEETING page is born from the upload dialog.
- **`MeetingUploadDialog`** (import-wizard-dialog precedent): file input (audio/video) → upload as `media` → a **required consent checkbox** (the consents-form `FormControlLabel`+`Checkbox`+linked-copy pattern; distinct `data-testid`) whose copy discloses recording/transcription, blocking submit until checked → a summary-instruction `<Select>` («Авто» + the workspace's saved `SummaryInstruction`s + a "custom" free-text option) → confirm calls `meeting.create` (which creates the MEETING page + the artifact + kicks the job) and navigates to the page.
- **`TranscriptSearchPanel`**: client-side filter over the in-memory segments (the search-dialog `InputBase`+debounce+`List`+`HighlightMatches` primitives); clicking a result scrolls to the segment.
- **`MeetingNotesBlock`** (the synced-block 6-hop injection): an atom node holding `meetingArtifactId`; `renderMeetingBlock` render-prop → `apps/web` `<MeetingBlockEmbed>` that runs `trpc.meeting.getById` and switches on a typed status union (`processing | ready | failed | no_access | not_found`) to show a compact status/summary card with a link to the full MEETING page; a gated slash item «Запись встречи» that opens the upload dialog (or picks an existing artifact). The block NEVER renders content the caller can't access (the 9C/9D access-checked render-prop precedent — `getById` is object-hiding).

## 7. Security / correctness invariants

1. **Consent is server-persisted + required:** `meeting.create` REQUIRES `consentAck === true` (400 otherwise) and persists it on the artifact; the client checkbox is not the only gate.
2. **Access:** all meeting reads/writes are workspace-membership + block gated; `meeting.getById`/`getByPage` are object-hiding (the synced-block precedent) — a non-member / blocked user / non-page-viewer gets `no_access`/not_found, never transcript content. The recording File download stays behind the existing `/api/files/[id]` access check.
3. **Provider (готовность):** summarization resolves the workspace `WorkspaceAiSettings.defaultModel` and aborts if unset — never a hidden global provider (the 9D guarantee, reused verbatim).
4. **No live paid transcription in tests:** the adapter is `provider="mock"` in all CI; the real adapter is never invoked by tests. Agents reads S3 via its own client; tests use the mock which doesn't require real audio decoding.
5. **agents service-token tier:** `/transcription` + `/meeting/summarize` use `verify_agents_service_token` (internal), NOT the chat JWT; they validate the `wsid` claim against the request's workspaceId.
6. **Deletion frees S3:** `meeting.delete` (+ the MEETING-page purge path) removes the recording's S3 object (S3-first ordering), not just DB rows — closing the known orphan-in-S3 gap.
7. **Plan gate before any agents/storage work:** `meetingsEnabled` checked at create + before the job kicks.
8. **Sanitized errors:** a FAILED artifact's `error` is a safe message (no provider secrets / internal stack).
9. **New env vars → the full deploy pipeline:** the agents S3 creds (S3_ENDPOINT/REGION/ACCESS_KEY/SECRET_KEY/BUCKET for apps/agents) must be added to `.env.example` + `turbo.json globalEnv` + the deploy `.env.template` + the deploy.yml env block + the GitHub secret (the recurring new-required-env-var rule — apps/agents reads its own settings, so confirm whether it already shares these or needs them added to its SettingsSchema + the agents container env).

## 8. Testing

- **agents (pytest):** the mock transcription adapter returns deterministic segments; `/transcription` with `provider="mock"` stores/returns segments; `/meeting/summarize` builds the model + returns `{summary, actionItems}` (mock the LLM `ainvoke`); the service-token guard rejects a bad token; `make()` error is caught (not a 500 crash). NO live provider, NO real S3 in tests (mock adapter ignores/stubs the key).
- **tRPC/unit (vitest, real-DB fixture-scoped):** `meeting.create` requires consentAck (400 without), creates the artifact + MEETING page + kicks the job, plan-gates on `meetingsEnabled`; `getById`/`getByPage` object-hiding for non-members; `searchSegments` (if server-side) or the client filter (pure test); `meeting.delete` removes S3 (mock the storage client, assert delete called) + DB rows; the job runner's state transitions (UPLOADED→TRANSCRIBING→SUMMARIZING→READY) with a mocked agents fetch; FAILED on agents error.
- **editor (vitest, pure):** the MeetingNotesBlock schema round-trip + the render-prop fallback; the TranscriptSearchPanel filter logic if extracted as a pure helper.
- **web (vitest):** plan-gate + the upload→create flow handler logic if split testably.
- **E2E (Playwright):** `apps/e2e/meetings.spec.ts` — `signUpAndAuthAs`, seed `meetingsEnabled` + `WorkspaceAiSettings.defaultModel` via Prisma; mock the agents `/transcription` + `/meeting/summarize` responses via `page.route` (deterministic segments + summary); open the upload dialog, pick a tiny media fixture (the 9B 36-byte mp4 / 74-byte mp3 fixtures), check consent (assert submit blocked until checked), pick «Авто», submit → assert navigation to the MEETING page, the processing banner, then (mock makes it ready) the summary + action items + a transcript segment; the TranscriptSearchPanel filters; a no-consent attempt is blocked. (In-session; no reload reliance — no yjs server.)

**Proof commands (cl9.md):** `pnpm --filter agents test`, `pnpm --filter @repo/trpc test`, `pnpm --filter web lint`, `pnpm check-types`. Plus the phase's build-first-then-forced-uncached-sweep merge gate + `check-architecture`.

## 9. File structure (finalized in the plan)

- `packages/db/prisma/schema.prisma` — the 4 models + MeetingStatus + Page.type MEETING + back-relations + migration.
- `apps/agents/agents/apps/transcription/` — `router.py` (`/transcription`, `/meeting/summarize`), `schemas.py`, `repositories/transcription_factory.py` (Protocol + Mock + Real), `repositories/s3_storage.py` (the new S3 client), `use_cases/transcribe.py` + `use_cases/summarize.py`, `depends.py` (TranscriptionProvider) + register in `agents/router.py` + the container; `settings.py` (S3 fields).
- `apps/web/src/server/jobs/process-meeting-job.ts` + add `'meeting'` to the JobRunnerPort kind + `kick.ts` dispatch.
- `apps/web/src/lib/agents/meeting-client.ts` — the service-token POST helpers (agents-validate.ts mold).
- `packages/trpc/src/routers/meeting.ts` — create/getById/getByPage/list/searchSegments/delete/setSummaryInstruction/listSummaryInstructions/createSummaryInstruction + the S3-delete on delete; register in index.ts.
- `packages/trpc/src/helpers/plan.ts` / `packages/domain/src/billing/{dto,repositories}` — the `meetingsEnabled` flag.
- `apps/web/src/components/meeting/` — `MeetingTranscriptPage.tsx`, `MeetingUploadDialog.tsx`, `TranscriptSearchPanel.tsx`, `meeting-block-embed.tsx`.
- `apps/web/src/components/page/page-renderer.tsx` + `pages/[pageId]/page.tsx` (isFullBleed) + `page-type-registry.tsx` (icon/label, NOT in the create grid) — the MEETING page-type wiring.
- `packages/editor/src/extensions/meeting-notes-block.ts(x)` + types/index/slash-items/anynote-editor + `page-renderer` render-prop — the MeetingNotesBlock injection thread.
- `apps/web/src/app/api/files/[id]` + the deletion path; `.env.example` + `turbo.json` + deploy template/yml for the agents S3 vars (if newly needed).
- `apps/e2e/meetings.spec.ts`, `docs/changelog.md`.

## 10. Honest limitations (state; don't over-promise)
- Uploaded recordings only — NO live capture, system audio, calendar, or desktop-app behavior (UI copy must not imply these).
- The default transcription adapter is a MOCK; a real provider must be configured by an operator and is never exercised in CI. Summaries use the workspace AI provider (not a proprietary model).
- 200MB recording cap (the media kind); the upload route buffers in memory — long recordings beyond ~3-4h won't fit. No streaming/presigned upload.
- Token counts not accounted (best-effort, as 9D).
- Single transcription language per artifact (detected/declared); no live diarization guarantees beyond what the adapter returns.
