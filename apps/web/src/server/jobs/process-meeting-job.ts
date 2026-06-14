import type { PrismaClient } from '@repo/db'

import type {
  CreateTranscriptionArgs,
  CreateTranscriptionResult,
  MeetingModelConfig,
  SummarizeMeetingArgs,
  SummarizeMeetingResult,
} from '@/lib/agents/meeting-client'

/**
 * The meeting processing runner (the 6A `process-import-job.ts` mold). The
 * `MeetingArtifact.status` IS the job state — no separate Job table. Steps:
 *
 *   UPLOADED ──claim──▶ TRANSCRIBING ──segments──▶ SUMMARIZING ──summary──▶ READY
 *                                  └──── any error / no default model ───▶ FAILED
 *
 * Liveness rides `heartbeatAt` (the 6A lazy-reclaim mold). The provider for
 * summarization is the WORKSPACE's own `defaultModel` (the 9D готовность
 * guarantee) — no default model → FAILED, NEVER a hidden global. Every failure
 * persists a SANITIZED message (no upstream body / provider secret).
 */

/** The resolved workspace model config (the 9D resolution), or null when unset. */
export type MeetingProviderResolution = {
  model: MeetingModelConfig
}

export type MeetingJobDeps = {
  prisma: Pick<PrismaClient, 'meetingArtifact' | 'transcriptSegment' | 'actionItem'>
  createTranscription: (args: CreateTranscriptionArgs) => Promise<CreateTranscriptionResult>
  summarizeMeeting: (args: SummarizeMeetingArgs) => Promise<SummarizeMeetingResult>
  /**
   * Resolve the workspace's default AI model (the 9D `WorkspaceAiSettings.defaultModel`
   * + `resolveProviderConnection`). Returns null when no default is configured —
   * the runner then FAILs rather than falling back to any global provider.
   */
  resolveProvider: (workspaceId: string) => Promise<MeetingProviderResolution | null>
}

/** Render the ordered segments into a plain transcript the summarizer consumes. */
function renderTranscript(segments: CreateTranscriptionResult['segments']): string {
  return segments
    .slice()
    .sort((a, b) => a.idx - b.idx)
    .map((s) => (s.speaker ? `${s.speaker}: ${s.text}` : s.text))
    .join('\n')
}

/** Sanitized failure: a known DomainError-style message, never the raw cause. */
async function markFailed(
  deps: MeetingJobDeps,
  artifactId: string,
  message: string,
): Promise<void> {
  await deps.prisma.meetingArtifact
    .update({
      where: { id: artifactId },
      data: { status: 'FAILED', error: message, heartbeatAt: new Date() },
    })
    .catch(() => {})
}

export async function processMeetingJob(artifactId: string, deps: MeetingJobDeps): Promise<void> {
  // 1. Atomic claim (idempotent, deploy-safe): only an UPLOADED artifact is
  //    taken. A re-kick of an already-claimed / done artifact matches no row.
  const now = new Date()
  const claimed = await deps.prisma.meetingArtifact.updateMany({
    where: { id: artifactId, status: 'UPLOADED' },
    data: { status: 'TRANSCRIBING', heartbeatAt: now, updatedAt: now, summary: null },
  })
  if (claimed.count === 0) return

  // Idempotent re-processing: a retry (FAILED→UPLOADED→re-claim) or a
  // heartbeat-reclaim re-kick re-runs this whole pipeline. The
  // `(meeting_id, idx)` index is NON-unique, so re-writing segments/action-items
  // without first clearing the prior partial run's rows would APPEND a second
  // full copy (→ 2N rows, duplicated idx, mis-ordered reads). Clear this
  // artifact's children NOW — after the atomic claim, before any write — so a
  // re-run produces exactly N rows regardless of how it was triggered. The
  // claim above already reset `summary` to null so a retry shows no stale
  // summary mid-reprocess.
  await deps.prisma.transcriptSegment.deleteMany({ where: { meetingId: artifactId } })
  await deps.prisma.actionItem.deleteMany({ where: { meetingId: artifactId } })

  try {
    const artifact = await deps.prisma.meetingArtifact.findUnique({
      where: { id: artifactId },
      select: {
        id: true,
        workspaceId: true,
        createdById: true,
        recording: { select: { path: true, mimeType: true } },
        summaryInstruction: { select: { instruction: true } },
      },
    })
    if (!artifact?.recording) throw new MeetingJobError('Запись встречи не найдена')

    // 2. Transcribe — agents reads the bytes from S3 by key (no bytes-in-payload).
    const transcription = await deps.createTranscription({
      userId: artifact.createdById,
      workspaceId: artifact.workspaceId,
      recordingS3Key: artifact.recording.path,
      mimeType: artifact.recording.mimeType,
    })

    if (transcription.segments.length > 0) {
      await deps.prisma.transcriptSegment.createMany({
        data: transcription.segments.map((s) => ({
          meetingId: artifactId,
          idx: s.idx,
          startMs: s.startMs,
          endMs: s.endMs,
          speaker: s.speaker ?? null,
          text: s.text,
        })),
      })
    }

    // Persist transcription metadata + advance to SUMMARIZING (heartbeat bump).
    await deps.prisma.meetingArtifact.update({
      where: { id: artifactId },
      data: {
        status: 'SUMMARIZING',
        language: transcription.language,
        durationMs: transcription.durationMs,
        heartbeatAt: new Date(),
      },
    })

    // 3. Provider (готовность): the workspace's OWN default model, or FAIL.
    const resolution = await deps.resolveProvider(artifact.workspaceId)
    if (!resolution) {
      throw new MeetingJobError('Не настроена модель AI по умолчанию для пространства')
    }

    // 4. Summarize the transcript with the resolved model.
    const transcript = renderTranscript(transcription.segments)
    const summary = await deps.summarizeMeeting({
      userId: artifact.createdById,
      workspaceId: artifact.workspaceId,
      model: resolution.model,
      transcript,
      summaryInstruction: artifact.summaryInstruction?.instruction ?? null,
    })

    if (summary.actionItems.length > 0) {
      await deps.prisma.actionItem.createMany({
        data: summary.actionItems.map((text, idx) => ({ meetingId: artifactId, idx, text })),
      })
    }

    // 5. Done.
    await deps.prisma.meetingArtifact.update({
      where: { id: artifactId },
      data: {
        status: 'READY',
        summary: summary.summary,
        error: null,
        heartbeatAt: new Date(),
      },
    })
  } catch (err) {
    // Sanitized: a known MeetingJobError message, else a generic fallback —
    // never the raw cause (which could carry provider secrets / a stack).
    const message =
      err instanceof MeetingJobError ? err.message : 'Не удалось обработать запись встречи'
    console.error('[meeting-job] failed', { artifactId, err })
    await markFailed(deps, artifactId, message)
  }
}

/** A processing error whose message is safe to persist on the artifact. */
class MeetingJobError extends Error {}
