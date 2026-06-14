import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import type { PrismaClient } from '@repo/db'
import { storage } from '@repo/storage'

import { router, protectedProcedure } from '../trpc'
import { assertWorkspaceMember, resolveMemberOrPageGrant } from '../helpers/page-access'
import { BLOCKED_MESSAGE } from '../helpers/membership'
import { getWorkspaceFeatures, requireWritableWorkspace } from '../helpers/plan'
import { mapDomain } from '../helpers/map-domain'
import { domain as domainSvc } from '../domain'
import { RECLAIM_AFTER_MS } from './job'

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A transcript segment as served to clients (the in-memory shape the
 * `TranscriptSearchPanel` and the transcript list render). Ordered by `idx`.
 */
export type MeetingSegment = {
  id: string
  idx: number
  startMs: number
  endMs: number
  speaker: string | null
  text: string
}

export type MeetingActionItem = {
  id: string
  idx: number
  text: string
  done: boolean
}

/**
 * The TYPED result `meeting.getById` / `meeting.getByPage` return — the union the
 * MEETING page renderer (Task 5) and the MeetingNotesBlock embed (Task 6) switch
 * on. OBJECT-HIDING (spec §7.2, the synced-block precedent): a non-member /
 * blocked user / non-page-viewer gets `no_access`, NEVER transcript content — the
 * query never throws on no-access so the client can distinguish the placeholder
 * states. `ok` carries the full READY artifact; `processing` is the in-progress
 * pipeline (UPLOADED/TRANSCRIBING/SUMMARIZING); `failed` carries the sanitized
 * error.
 *
 * Note: the union uses `ok` (the synced-block precedent), not `ready` — the
 * status field still distinguishes processing vs ok; consumers (T5/T6) honor it.
 */
export type MeetingReadResult =
  | {
      status: 'ok'
      id: string
      pageId: string | null
      title: string
      summary: string | null
      language: string | null
      durationMs: number | null
      segments: MeetingSegment[]
      actionItems: MeetingActionItem[]
      readOnly: boolean
    }
  | { status: 'processing'; id: string; pageId: string | null; title: string; stage: string }
  | { status: 'failed'; id: string; pageId: string | null; title: string; error: string | null }
  | { status: 'no_access' }
  | { status: 'not_found' }

type Ctx = {
  prisma: PrismaClient
  user: { id: string }
  jobs?: { kick(jobId: string, kind: 'import' | 'export' | 'meeting'): void }
}

const NO_ACCESS: MeetingReadResult = { status: 'no_access' }
const NOT_FOUND: MeetingReadResult = { status: 'not_found' }

const PROCESSING_STATUSES = new Set(['UPLOADED', 'TRANSCRIBING', 'SUMMARIZING'])

// The in-progress statuses that a CRASHED runner can strand. (UPLOADED is also a
// processing status but is the post-claim/queued state the runner picks up — it
// is never "stalled mid-run"; resetting it to UPLOADED would be a no-op anyway,
// so the reclaim only targets the two mid-pipeline states a heartbeat protects.)
const STALLABLE_STATUSES = ['TRANSCRIBING', 'SUMMARIZING'] as const

// ── Stalled-meeting lazy reclaim ────────────────────────────────────────────

/**
 * Crash recovery for the meeting pipeline, the job.list lazy-reclaim spirit
 * applied to the only natural hook a meeting has: the read query the transcript
 * page (`getByPage`) and the embed (`getById`) poll every 3s while `processing`.
 *
 * The runner writes `heartbeatAt`, but the only USER-driven recovery is
 * `meeting.retry`, which acts on a FAILED artifact only. A runner that CRASHES
 * mid-TRANSCRIBING/SUMMARIZING leaves the artifact in a non-FAILED in-progress
 * status with a stale heartbeat → stuck forever (retry won't touch it, the
 * client just spins). So on every poll we atomically reclaim a stalled
 * in-progress artifact: status in (TRANSCRIBING, SUMMARIZING) AND heartbeat null
 * or older than RECLAIM_AFTER_MS → reset to UPLOADED (clearing error/heartbeat)
 * and re-kick. The runner's atomic claim (`where status: UPLOADED`) then re-runs
 * the whole pipeline; it clears this artifact's children first, so no
 * duplication. A FRESH heartbeat is left alone (a healthy run isn't disturbed);
 * a READY/FAILED artifact never matches.
 *
 * The reset is an `updateMany` guarded by the same status+heartbeat predicate
 * (the job.list precedent) so a concurrent poller can't double-reset/double-kick
 * — only the first updateMany sees count===1 and fires the kick. On a successful
 * reclaim the in-memory artifact's status is advanced to UPLOADED so the
 * projection this same request returns reflects the reset (still `processing`),
 * not a stale stage.
 */
async function reclaimIfStalled(
  ctx: Ctx,
  artifact: { id: string; status: string; heartbeatAt: Date | null },
): Promise<void> {
  if (!STALLABLE_STATUSES.includes(artifact.status as (typeof STALLABLE_STATUSES)[number])) {
    return
  }
  const staleBefore = new Date(Date.now() - RECLAIM_AFTER_MS)
  if (artifact.heartbeatAt !== null && artifact.heartbeatAt.getTime() >= staleBefore.getTime()) {
    return // fresh heartbeat — a healthy run, leave it
  }
  // Atomic transition guards against a concurrent poller racing the same reset.
  const res = await ctx.prisma.meetingArtifact.updateMany({
    where: {
      id: artifact.id,
      status: { in: [...STALLABLE_STATUSES] },
      OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: staleBefore } }],
    },
    data: { status: 'UPLOADED', error: null, heartbeatAt: null },
  })
  if (res.count === 1) {
    artifact.status = 'UPLOADED'
    artifact.heartbeatAt = null
    ctx.jobs?.kick(artifact.id, 'meeting')
  }
}

// ── Access helpers ──────────────────────────────────────────────────────────

/**
 * The single access authority for a meeting artifact. A member (block-aware) of
 * the artifact's workspace OR the holder of a PageShareUser grant on the
 * artifact's MEETING page (or an ancestor) is admitted; `readOnly` is true for a
 * non-edit member (VIEWER/COMMENTER) or a non-EDITOR grant. Returns null for
 * anyone with no relationship (object-hiding). Mirrors the synced-block
 * origin-access gate so the two never drift.
 *
 * Blocked-member contract: the page-grant resolver (`resolveMemberOrPageGrant`)
 * THROWS FORBIDDEN for a blocked member (canonical `assertNotBlocked`
 * semantics), which the MUTATIONS (delete/retry/toggleActionItem) want — a
 * blocked member must be rejected hard. But the READ queries (getById/getByPage/
 * searchSegments) are documented as NEVER throwing on no-access: they return the
 * typed `no_access` placeholder so the T5/T6 consumers can distinguish it from a
 * real error. So `opts.forRead` makes a blocked throw degrade to null (→
 * no_access) instead of propagating — keeping the object-hiding union honest
 * without weakening the mutation gates. (No content leak either way: a blocked
 * user can't see content under either outcome; this only fixes the shape.) The
 * `pageId == null` branch already returns null for a blocked member, so it needs
 * no read/write distinction.
 */
async function resolveMeetingAccess(
  ctx: Ctx,
  artifact: { workspaceId: string; pageId: string | null },
  opts: { forRead?: boolean } = {},
): Promise<{ readOnly: boolean } | null> {
  // Without a page anchor we can only gate on workspace membership (a meeting is
  // always page-anchored once created, but guard the null case defensively: a
  // blocked or non-member user is denied).
  if (!artifact.pageId) {
    const member = await ctx.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: artifact.workspaceId, userId: ctx.user.id } },
      select: { role: true },
    })
    if (!member) return null
    const blocked = await ctx.prisma.workspaceBlockedUser.findUnique({
      where: { workspaceId_userId: { workspaceId: artifact.workspaceId, userId: ctx.user.id } },
      select: { userId: true },
    })
    if (blocked) return null
    const canEdit = member.role === 'OWNER' || member.role === 'ADMIN' || member.role === 'EDITOR'
    return { readOnly: !canEdit }
  }
  let access
  try {
    access = await resolveMemberOrPageGrant(ctx, artifact.workspaceId, artifact.pageId)
  } catch (err) {
    // The only throw `resolveMemberOrPageGrant` raises is the blocked-member
    // FORBIDDEN. On the read path degrade it to no_access (null); on the write
    // path re-throw so the mutation stays gated.
    if (opts.forRead && err instanceof TRPCError && err.message === BLOCKED_MESSAGE) {
      return null
    }
    throw err
  }
  if (!access) return null
  const canEdit = access.role === 'OWNER' || access.role === 'ADMIN' || access.role === 'EDITOR'
  return { readOnly: !canEdit }
}

/** Project a row (with relations) onto the typed read union. */
function toReadResult(
  artifact: {
    id: string
    pageId: string | null
    title: string
    status: string
    summary: string | null
    language: string | null
    durationMs: number | null
    error: string | null
    segments?: MeetingSegment[]
    actionItems?: MeetingActionItem[]
  },
  readOnly: boolean,
): MeetingReadResult {
  if (artifact.status === 'FAILED') {
    return {
      status: 'failed',
      id: artifact.id,
      pageId: artifact.pageId,
      title: artifact.title,
      error: artifact.error,
    }
  }
  if (PROCESSING_STATUSES.has(artifact.status)) {
    return {
      status: 'processing',
      id: artifact.id,
      pageId: artifact.pageId,
      title: artifact.title,
      stage: artifact.status,
    }
  }
  return {
    status: 'ok',
    id: artifact.id,
    pageId: artifact.pageId,
    title: artifact.title,
    summary: artifact.summary,
    language: artifact.language,
    durationMs: artifact.durationMs,
    segments: artifact.segments ?? [],
    actionItems: artifact.actionItems ?? [],
    readOnly,
  }
}

// ── S3-freeing delete (shared with the MEETING-page hard-delete route) ───────

/**
 * Free the S3 object for a MEETING page's recording, then drop the artifact and
 * its File row. Used by BOTH `meeting.delete` and the page hard-delete route
 * (`page.hardDelete` / `page.emptyTrash`) — the domain layer cannot reach S3
 * (spec §5), so the tRPC layer owns the S3 side-effect. Ordering is S3-FIRST
 * (the engines `delete_file` precedent): an orphaned object is recoverable
 * garbage, whereas a row pointing at a missing object 404s every future read.
 * The `recording` FK is `onDelete: Restrict`, so the artifact must be deleted
 * before the File (the artifact is the only thing holding the reference; its
 * segments/action-items cascade with it). Idempotent — a missing artifact is a
 * silent no-op.
 */
export async function freeMeetingPageRecording(
  prisma: PrismaClient,
  pageId: string,
): Promise<void> {
  const artifact = await prisma.meetingArtifact.findUnique({
    where: { pageId },
    select: { id: true, recordingFileId: true, recording: { select: { path: true } } },
  })
  if (!artifact) return
  await freeRecording(prisma, artifact)
}

/** The S3-first delete core, shared by both entry points. */
async function freeRecording(
  prisma: PrismaClient,
  artifact: { id: string; recordingFileId: string; recording: { path: string } | null },
): Promise<void> {
  if (artifact.recording?.path) {
    // S3-FIRST: drop the object before the DB rows (the engines delete_file rule).
    await storage.delete(artifact.recording.path)
  }
  // Delete the artifact first (cascades segments/action-items + releases the
  // Restrict FK on the File), then the File row.
  await prisma.meetingArtifact.delete({ where: { id: artifact.id } })
  await prisma.file.deleteMany({ where: { id: artifact.recordingFileId } })
}

// ── Router ──────────────────────────────────────────────────────────────────

export const meetingRouter = router({
  // Create a MEETING page + its MeetingArtifact and kick the processing job.
  // Gated: workspace membership + writable workspace + the `meetingsEnabled`
  // plan flag (403) + REQUIRED consentAck (400, spec §7.1 — server-persisted,
  // the client checkbox is not the only gate). The recording File must belong to
  // the workspace. The summary instruction is resolved (an existing instruction)
  // or created (a free-text custom instruction).
  create: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        recordingFileId: z.string().uuid(),
        consentAck: z.boolean(),
        title: z.string().trim().min(1).max(200).optional(),
        summaryInstructionId: z.string().uuid().optional(),
        customInstruction: z.string().trim().min(1).max(4000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{ pageId: string; artifactId: string }> => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      await requireWritableWorkspace(input.workspaceId)

      // Plan gate — before any storage/agents work (spec §7.7).
      const features = await getWorkspaceFeatures(input.workspaceId)
      if (!features.meetingsEnabled) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Транскрипция встреч недоступна на вашем тарифе',
        })
      }

      // Consent is server-persisted + required (spec §7.1).
      if (input.consentAck !== true) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Требуется согласие на запись и расшифровку встречи',
        })
      }

      // The recording must be an ACTIVE File in THIS workspace (never trust the
      // client to point at a foreign file).
      const recording = await ctx.prisma.file.findFirst({
        where: { id: input.recordingFileId, workspaceId: input.workspaceId, status: 'ACTIVE' },
        select: { id: true },
      })
      if (!recording) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Файл записи не найден' })
      }

      // Resolve the summary instruction: an explicit existing one (validated to
      // this workspace) wins; otherwise a custom free-text instruction creates a
      // workspace-scoped SummaryInstruction; otherwise «Авто» (null).
      let summaryInstructionId: string | null = null
      if (input.summaryInstructionId) {
        const existing = await ctx.prisma.summaryInstruction.findFirst({
          where: { id: input.summaryInstructionId, workspaceId: input.workspaceId },
          select: { id: true },
        })
        if (!existing) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Инструкция не найдена' })
        }
        summaryInstructionId = existing.id
      } else if (input.customInstruction) {
        const made = await ctx.prisma.summaryInstruction.create({
          data: {
            workspaceId: input.workspaceId,
            name: 'Своя инструкция',
            instruction: input.customInstruction,
            createdById: ctx.user.id,
          },
          select: { id: true },
        })
        summaryInstructionId = made.id
      }

      const title = input.title ?? 'Встреча'

      // The MEETING page is a workspace artifact → create through the domain so
      // it gets the linked-list positioning + outbox enqueue (the one page-create
      // path); `location: 'team'` makes it a TEAM-collection page (visible to all
      // workspace members, as a meeting should be).
      const page = await mapDomain(() =>
        domainSvc.pages.create(ctx.user.id, {
          workspaceId: input.workspaceId,
          parentId: null,
          type: 'MEETING',
          title,
          location: 'team',
        }),
      )

      const artifact = await ctx.prisma.meetingArtifact.create({
        data: {
          workspaceId: input.workspaceId,
          pageId: page.id,
          createdById: ctx.user.id,
          recordingFileId: input.recordingFileId,
          title,
          status: 'UPLOADED',
          consentAck: true,
          summaryInstructionId,
        },
        select: { id: true },
      })

      // Kick the async pipeline (transcribe → summarize). The runner claims the
      // UPLOADED row atomically, so a duplicate kick is safe.
      ctx.jobs?.kick(artifact.id, 'meeting')

      return { pageId: page.id, artifactId: artifact.id }
    }),

  // Object-hiding read by artifact id. Never throws on no-access. Opportunistic
  // crash recovery: a stalled in-progress artifact (stale/null heartbeat) is
  // reclaimed + re-kicked here (the embed poll path) before projecting.
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<MeetingReadResult> => {
      const artifact = await ctx.prisma.meetingArtifact.findUnique({
        where: { id: input.id },
        select: {
          id: true,
          workspaceId: true,
          pageId: true,
          title: true,
          status: true,
          summary: true,
          language: true,
          durationMs: true,
          error: true,
          heartbeatAt: true,
        },
      })
      if (!artifact) return NOT_FOUND
      const access = await resolveMeetingAccess(ctx, artifact, { forRead: true })
      if (!access) return NO_ACCESS
      // Only members (access granted) can trigger the reclaim — no anonymous /
      // no-access poke at the runner.
      await reclaimIfStalled(ctx, artifact)
      return loadAndProject(ctx, artifact, access.readOnly)
    }),

  // Object-hiding read by the owning MEETING page id. This is the query the
  // MEETING transcript page polls every 3s while processing — the natural hook
  // for the stalled-artifact lazy reclaim (job.list spirit).
  getByPage: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<MeetingReadResult> => {
      const artifact = await ctx.prisma.meetingArtifact.findUnique({
        where: { pageId: input.pageId },
        select: {
          id: true,
          workspaceId: true,
          pageId: true,
          title: true,
          status: true,
          summary: true,
          language: true,
          durationMs: true,
          error: true,
          heartbeatAt: true,
        },
      })
      if (!artifact) return NOT_FOUND
      const access = await resolveMeetingAccess(ctx, artifact, { forRead: true })
      if (!access) return NO_ACCESS
      // Crashed-runner recovery: re-kick a stalled in-progress artifact (no user
      // action needed). Gated behind the access check above (members only).
      await reclaimIfStalled(ctx, artifact)
      return loadAndProject(ctx, artifact, access.readOnly)
    }),

  // Workspace-scoped artifact list, member-gated. Access is workspace-level here
  // (every MEETING page is a TEAM artifact); per-row page-grant filtering is not
  // needed because non-members are already FORBIDDEN.
  list: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      const rows = await ctx.prisma.meetingArtifact.findMany({
        where: { workspaceId: input.workspaceId },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
          pageId: true,
          title: true,
          status: true,
          durationMs: true,
          createdAt: true,
        },
      })
      return { meetings: rows }
    }),

  // Access-gated server-side transcript search (substring, case-insensitive).
  searchSegments: protectedProcedure
    .input(z.object({ meetingId: z.string().uuid(), q: z.string().trim().max(200) }))
    .query(async ({ ctx, input }) => {
      const artifact = await ctx.prisma.meetingArtifact.findUnique({
        where: { id: input.meetingId },
        select: { id: true, workspaceId: true, pageId: true },
      })
      if (!artifact) throw new TRPCError({ code: 'NOT_FOUND', message: 'Встреча не найдена' })
      // Read path: a blocked member degrades to the uniform NOT_FOUND
      // object-hiding throw (the same a non-member gets), not a blocked-oracle
      // FORBIDDEN.
      const access = await resolveMeetingAccess(ctx, artifact, { forRead: true })
      if (!access) throw new TRPCError({ code: 'NOT_FOUND', message: 'Встреча не найдена' })

      const segments = await ctx.prisma.transcriptSegment.findMany({
        where: {
          meetingId: artifact.id,
          ...(input.q ? { text: { contains: input.q, mode: 'insensitive' as const } } : {}),
        },
        orderBy: { idx: 'asc' },
        select: { id: true, idx: true, startMs: true, endMs: true, speaker: true, text: true },
        take: 500,
      })
      return { segments }
    }),

  // Toggle an action-item's done state — access-gated through the parent meeting.
  toggleActionItem: protectedProcedure
    .input(z.object({ id: z.string().uuid(), done: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.prisma.actionItem.findUnique({
        where: { id: input.id },
        select: { id: true, meeting: { select: { workspaceId: true, pageId: true } } },
      })
      if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: 'Пункт не найден' })
      const access = await resolveMeetingAccess(ctx, item.meeting)
      if (!access) throw new TRPCError({ code: 'NOT_FOUND', message: 'Пункт не найден' })
      if (access.readOnly) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав на редактирование' })
      }
      await ctx.prisma.actionItem.update({ where: { id: input.id }, data: { done: input.done } })
      return { ok: true }
    }),

  // Re-run a FAILED artifact: reset to UPLOADED, clear the error, re-kick.
  // Access-gated (edit). Idempotent on a non-FAILED row (no-op + no re-kick).
  retry: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const artifact = await ctx.prisma.meetingArtifact.findUnique({
        where: { id: input.id },
        select: { id: true, workspaceId: true, pageId: true, status: true },
      })
      if (!artifact) throw new TRPCError({ code: 'NOT_FOUND', message: 'Встреча не найдена' })
      const access = await resolveMeetingAccess(ctx, artifact)
      if (!access) throw new TRPCError({ code: 'NOT_FOUND', message: 'Встреча не найдена' })
      if (access.readOnly) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав на редактирование' })
      }
      if (artifact.status !== 'FAILED') return { ok: true }
      await ctx.prisma.meetingArtifact.update({
        where: { id: artifact.id },
        data: { status: 'UPLOADED', error: null, heartbeatAt: null },
      })
      ctx.jobs?.kick(artifact.id, 'meeting')
      return { ok: true }
    }),

  // Delete a meeting: free the recording's S3 object (S3-FIRST) then drop the
  // artifact + File row (segments/action-items cascade). Access-gated (edit).
  // Idempotent — a missing/already-deleted artifact returns ok without an S3 hit.
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const artifact = await ctx.prisma.meetingArtifact.findUnique({
        where: { id: input.id },
        select: {
          id: true,
          workspaceId: true,
          pageId: true,
          recordingFileId: true,
          recording: { select: { path: true } },
        },
      })
      if (!artifact) return { ok: true } // idempotent
      const access = await resolveMeetingAccess(ctx, artifact)
      if (!access) throw new TRPCError({ code: 'NOT_FOUND', message: 'Встреча не найдена' })
      if (access.readOnly) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав на редактирование' })
      }
      await freeRecording(ctx.prisma, artifact)
      return { ok: true }
    }),

  // ── Summary instructions (workspace-scoped, member-gated) ──────────────────
  listSummaryInstructions: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      const instructions = await ctx.prisma.summaryInstruction.findMany({
        where: { workspaceId: input.workspaceId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, instruction: true, createdAt: true },
        take: 200,
      })
      return { instructions }
    }),

  createSummaryInstruction: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        name: z.string().trim().min(1).max(120),
        instruction: z.string().trim().min(1).max(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      const made = await ctx.prisma.summaryInstruction.create({
        data: {
          workspaceId: input.workspaceId,
          name: input.name,
          instruction: input.instruction,
          createdById: ctx.user.id,
        },
        select: { id: true, name: true, instruction: true, createdAt: true },
      })
      return made
    }),
})

// Load segments/action-items for an OK artifact and project to the read union.
// (Processing/failed states don't need the heavy child loads.)
async function loadAndProject(
  ctx: Ctx,
  artifact: {
    id: string
    pageId: string | null
    title: string
    status: string
    summary: string | null
    language: string | null
    durationMs: number | null
    error: string | null
  },
  readOnly: boolean,
): Promise<MeetingReadResult> {
  if (artifact.status === 'FAILED' || PROCESSING_STATUSES.has(artifact.status)) {
    return toReadResult(artifact, readOnly)
  }
  const [segments, actionItems] = await Promise.all([
    ctx.prisma.transcriptSegment.findMany({
      where: { meetingId: artifact.id },
      orderBy: { idx: 'asc' },
      select: { id: true, idx: true, startMs: true, endMs: true, speaker: true, text: true },
    }),
    ctx.prisma.actionItem.findMany({
      where: { meetingId: artifact.id },
      orderBy: { idx: 'asc' },
      select: { id: true, idx: true, text: true, done: true },
    }),
  ])
  return toReadResult({ ...artifact, segments, actionItems }, readOnly)
}
