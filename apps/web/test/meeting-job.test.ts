import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  processMeetingJob,
  type MeetingJobDeps,
  type MeetingProviderResolution,
} from '../src/server/jobs/process-meeting-job'

const artifactId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const workspaceId = '22222222-2222-2222-2222-222222222222'
const userId = '33333333-3333-3333-3333-333333333333'
const recordingFileId = '44444444-4444-4444-4444-444444444444'
const recordingPath = 'media/abc.mp4'

/** A loaded artifact row as the runner reads it after a successful claim. */
function loadedArtifact() {
  return {
    id: artifactId,
    workspaceId,
    createdById: userId,
    recordingFileId,
    status: 'TRANSCRIBING' as const,
    summaryInstructionId: null as string | null,
    recording: { path: recordingPath, mimeType: 'video/mp4' },
    summaryInstruction: null as { instruction: string } | null,
  }
}

const goodProvider: MeetingProviderResolution = {
  model: {
    provider: 'openai',
    name: 'gpt-4o-mini',
    connection: { api_key: 'sk-test' },
    settings: { temperature: 0.4, topP: 0.9 },
  },
}

function makeDeps(overrides: Partial<MeetingJobDeps> = {}): {
  deps: MeetingJobDeps
  updateMany: ReturnType<typeof vi.fn>
  artifactUpdate: ReturnType<typeof vi.fn>
  segCreate: ReturnType<typeof vi.fn>
  actionCreate: ReturnType<typeof vi.fn>
  createTranscription: ReturnType<typeof vi.fn>
  summarizeMeeting: ReturnType<typeof vi.fn>
  resolveProvider: ReturnType<typeof vi.fn>
} {
  const updateMany = vi.fn(async () => ({ count: 1 }))
  const artifactUpdate = vi.fn(async () => ({ id: artifactId }))
  const segCreate = vi.fn(async () => ({ count: 1 }))
  const actionCreate = vi.fn(async () => ({ count: 1 }))
  const findUnique = vi.fn(async () => loadedArtifact())

  const createTranscription = vi.fn(async () => ({
    segments: [
      { idx: 0, startMs: 0, endMs: 1000, speaker: 'A', text: 'Привет' },
      { idx: 1, startMs: 1000, endMs: 2000, speaker: 'B', text: 'Здравствуйте' },
    ],
    language: 'ru',
    durationMs: 2000,
  }))
  const summarizeMeeting = vi.fn(async () => ({
    summary: 'Резюме встречи',
    actionItems: ['Сделать X', 'Сделать Y'],
  }))
  const resolveProvider = vi.fn(async (): Promise<MeetingProviderResolution | null> => goodProvider)

  const prisma = {
    meetingArtifact: {
      updateMany,
      update: artifactUpdate,
      findUnique,
    },
    transcriptSegment: { createMany: segCreate, deleteMany: vi.fn(async () => ({ count: 0 })) },
    actionItem: { createMany: actionCreate, deleteMany: vi.fn(async () => ({ count: 0 })) },
  }

  const deps: MeetingJobDeps = {
    prisma: prisma as unknown as MeetingJobDeps['prisma'],
    createTranscription: createTranscription as unknown as MeetingJobDeps['createTranscription'],
    summarizeMeeting: summarizeMeeting as unknown as MeetingJobDeps['summarizeMeeting'],
    resolveProvider: resolveProvider as unknown as MeetingJobDeps['resolveProvider'],
    ...overrides,
  }
  return {
    deps,
    updateMany,
    artifactUpdate,
    segCreate,
    actionCreate,
    createTranscription,
    summarizeMeeting,
    resolveProvider,
  }
}

/** Pull the status off the data of the Nth meetingArtifact.update call. */
function statusOfUpdate(artifactUpdate: ReturnType<typeof vi.fn>, n: number): string | undefined {
  return artifactUpdate.mock.calls[n]?.[0]?.data?.status
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('processMeetingJob — atomic claim', () => {
  it('claims UPLOADED → TRANSCRIBING via updateMany', async () => {
    const { deps, updateMany } = makeDeps()
    await processMeetingJob(artifactId, deps)
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: artifactId, status: 'UPLOADED' },
        data: expect.objectContaining({ status: 'TRANSCRIBING' }),
      }),
    )
  })

  it('is idempotent — returns early when the claim matches no row (count 0)', async () => {
    const { deps, updateMany, createTranscription, summarizeMeeting } = makeDeps({})
    updateMany.mockResolvedValueOnce({ count: 0 })
    await processMeetingJob(artifactId, deps)
    expect(createTranscription).not.toHaveBeenCalled()
    expect(summarizeMeeting).not.toHaveBeenCalled()
  })
})

describe('processMeetingJob — happy path transitions', () => {
  it('transcribes → writes segments → SUMMARIZING → summarizes → writes summary+actions → READY', async () => {
    const { deps, artifactUpdate, segCreate, actionCreate, createTranscription, summarizeMeeting } =
      makeDeps()
    await processMeetingJob(artifactId, deps)

    // transcription called with the recording key + mime
    expect(createTranscription).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        workspaceId,
        recordingS3Key: recordingPath,
        mimeType: 'video/mp4',
      }),
    )
    // segments written
    expect(segCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ meetingId: artifactId, idx: 0, text: 'Привет' }),
        ]),
      }),
    )
    // SUMMARIZING was set before the summarize call
    expect(statusOfUpdate(artifactUpdate, 0)).toBe('SUMMARIZING')
    // summarize ran with a non-empty transcript + the resolved model
    expect(summarizeMeeting).toHaveBeenCalledWith(
      expect.objectContaining({
        model: goodProvider.model,
        transcript: expect.stringContaining('Привет'),
      }),
    )
    // action items written
    expect(actionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ meetingId: artifactId, idx: 0, text: 'Сделать X' }),
        ]),
      }),
    )
    // final status READY (last update) + summary persisted
    const last = artifactUpdate.mock.calls.at(-1)?.[0]?.data
    expect(last?.status).toBe('READY')
    expect(last?.summary).toBe('Резюме встречи')
  })

  it('bumps heartbeatAt between phases', async () => {
    const { deps, updateMany, artifactUpdate } = makeDeps()
    await processMeetingJob(artifactId, deps)
    // claim sets heartbeatAt
    expect(updateMany.mock.calls[0]?.[0]?.data?.heartbeatAt).toBeInstanceOf(Date)
    // at least one mid-pipeline update bumps heartbeatAt (the SUMMARIZING transition)
    const bumped = artifactUpdate.mock.calls.some((c) => c?.[0]?.data?.heartbeatAt instanceof Date)
    expect(bumped).toBe(true)
  })
})

describe('processMeetingJob — provider готовность (no global)', () => {
  it('sets FAILED with a clear error and never summarizes when no default model is configured', async () => {
    const { deps, artifactUpdate, summarizeMeeting } = makeDeps({
      resolveProvider: vi.fn(async () => null) as unknown as MeetingJobDeps['resolveProvider'],
    })
    await processMeetingJob(artifactId, deps)
    expect(summarizeMeeting).not.toHaveBeenCalled()
    const last = artifactUpdate.mock.calls.at(-1)?.[0]?.data
    expect(last?.status).toBe('FAILED')
    expect(String(last?.error)).toMatch(/модел|model/i)
  })
})

describe('processMeetingJob — sanitized failures', () => {
  it('marks FAILED when transcription throws', async () => {
    const { deps, artifactUpdate } = makeDeps({
      createTranscription: vi.fn(async () => {
        throw new Error('boom-secret')
      }) as unknown as MeetingJobDeps['createTranscription'],
    })
    await processMeetingJob(artifactId, deps)
    const last = artifactUpdate.mock.calls.at(-1)?.[0]?.data
    expect(last?.status).toBe('FAILED')
    expect(typeof last?.error).toBe('string')
    expect(last?.error).not.toContain('boom-secret')
  })

  it('marks FAILED when summarize throws', async () => {
    const { deps, artifactUpdate } = makeDeps({
      summarizeMeeting: vi.fn(async () => {
        throw new Error('llm-down')
      }) as unknown as MeetingJobDeps['summarizeMeeting'],
    })
    await processMeetingJob(artifactId, deps)
    const last = artifactUpdate.mock.calls.at(-1)?.[0]?.data
    expect(last?.status).toBe('FAILED')
    expect(last?.error).not.toContain('llm-down')
  })
})

// A re-processed artifact (retry after a partial run, or a heartbeat-reclaim
// re-kick) must produce exactly N children — never APPEND a second copy onto the
// rows a prior partial run already wrote. The `(meeting_id, idx)` index is
// NON-unique, so an un-cleared `createMany` would silently double everything and
// corrupt ordering. The runner must clear this artifact's children right after
// the claim, before writing any segments/action-items.
describe('processMeetingJob — idempotent re-processing (no child duplication)', () => {
  type SegRow = { meetingId: string; idx: number; text: string }
  type ActionRow = { meetingId: string; idx: number; text: string }

  /** A stateful prisma double whose segment/action tables survive across calls. */
  function statefulDeps(opts: { preSegments?: SegRow[]; preActions?: ActionRow[] } = {}) {
    const segments: SegRow[] = [...(opts.preSegments ?? [])]
    const actions: ActionRow[] = [...(opts.preActions ?? [])]

    const segDelete = vi.fn(async ({ where }: { where: { meetingId: string } }) => {
      const before = segments.length
      for (let i = segments.length - 1; i >= 0; i--) {
        if (segments[i]!.meetingId === where.meetingId) segments.splice(i, 1)
      }
      return { count: before - segments.length }
    })
    const segCreate = vi.fn(async ({ data }: { data: SegRow[] }) => {
      segments.push(...data)
      return { count: data.length }
    })
    const actionDelete = vi.fn(async ({ where }: { where: { meetingId: string } }) => {
      const before = actions.length
      for (let i = actions.length - 1; i >= 0; i--) {
        if (actions[i]!.meetingId === where.meetingId) actions.splice(i, 1)
      }
      return { count: before - actions.length }
    })
    const actionCreate = vi.fn(async ({ data }: { data: ActionRow[] }) => {
      actions.push(...data)
      return { count: data.length }
    })

    const prisma = {
      meetingArtifact: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async () => ({ id: artifactId })),
        findUnique: vi.fn(async () => loadedArtifact()),
      },
      transcriptSegment: { createMany: segCreate, deleteMany: segDelete },
      actionItem: { createMany: actionCreate, deleteMany: actionDelete },
    }

    const deps: MeetingJobDeps = {
      prisma: prisma as unknown as MeetingJobDeps['prisma'],
      createTranscription: vi.fn(async () => ({
        segments: [
          { idx: 0, startMs: 0, endMs: 1000, speaker: 'A', text: 'Привет' },
          { idx: 1, startMs: 1000, endMs: 2000, speaker: 'B', text: 'Здравствуйте' },
        ],
        language: 'ru',
        durationMs: 2000,
      })) as unknown as MeetingJobDeps['createTranscription'],
      summarizeMeeting: vi.fn(async () => ({
        summary: 'Резюме встречи',
        actionItems: ['Сделать X', 'Сделать Y'],
      })) as unknown as MeetingJobDeps['summarizeMeeting'],
      resolveProvider: vi.fn(async () => goodProvider) as unknown as MeetingJobDeps['resolveProvider'],
    }
    return { deps, segments, actions, segDelete, actionDelete }
  }

  it('produces exactly N segments (not 2N) when the artifact already has prior-run rows', async () => {
    // Simulate a prior partial run: 2 segments already written under this artifact.
    const { deps, segments, segDelete } = statefulDeps({
      preSegments: [
        { meetingId: artifactId, idx: 0, text: 'stale-0' },
        { meetingId: artifactId, idx: 1, text: 'stale-1' },
      ],
    })
    await processMeetingJob(artifactId, deps)
    // Existing rows must be cleared before the new createMany.
    expect(segDelete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { meetingId: artifactId } }),
    )
    // Exactly the adapter's N=2 — NOT 2N=4.
    expect(segments).toHaveLength(2)
    expect(segments.map((s) => s.idx).sort((a, b) => a - b)).toEqual([0, 1])
    expect(segments.map((s) => s.text).sort()).toEqual(['Здравствуйте', 'Привет'])
  })

  it('produces exactly N action-items (not 2N) when the artifact already has prior-run rows', async () => {
    const { deps, actions, actionDelete } = statefulDeps({
      preActions: [
        { meetingId: artifactId, idx: 0, text: 'stale-action-0' },
        { meetingId: artifactId, idx: 1, text: 'stale-action-1' },
      ],
    })
    await processMeetingJob(artifactId, deps)
    expect(actionDelete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { meetingId: artifactId } }),
    )
    expect(actions).toHaveLength(2)
    expect(actions.map((a) => a.idx).sort((a, b) => a - b)).toEqual([0, 1])
  })
})
