import { signAgentsServiceToken } from '@repo/trpc'

/**
 * In-web client for the apps/agents transcription + meeting-summarize
 * endpoints (the `agents-validate.ts postValidate` mold). Both calls sign a
 * short-lived internal service token (`signAgentsServiceToken`) and POST to the
 * service-token tier of apps/agents. The wire format is camelCase (the agents
 * `RequestResponseSchema` aliases snake_case ↔ camelCase), so we send and parse
 * camelCase directly. Errors are SANITIZED — never the upstream body or a
 * provider secret — so a FAILED MeetingArtifact carries a safe message.
 */

function agentsBaseUrl(): string {
  return process.env.AGENTS_SERVICE_URL ?? 'http://localhost:8080'
}

/** Per-call timeout; transcription of a long recording can take a while. */
const TRANSCRIBE_TIMEOUT_MS = 300_000
const SUMMARIZE_TIMEOUT_MS = 120_000

export type TranscriptSegmentDto = {
  idx: number
  startMs: number
  endMs: number
  speaker?: string | null
  text: string
}

export type CreateTranscriptionResult = {
  segments: TranscriptSegmentDto[]
  language: string | null
  durationMs: number | null
}

export type SummarizeMeetingResult = {
  summary: string
  actionItems: string[]
}

/**
 * The workspace model config forwarded to `/meeting/summarize`. Shape mirrors
 * the agents `ModelConfigSchema` (provider = the lowercased ModelProviderEnum
 * value, name = the model slug, connection = the resolved credential map).
 */
export type MeetingModelConfig = {
  provider: string
  name: string
  connection: Record<string, string>
  settings?: { temperature?: number | null; topP?: number | null }
}

export type CreateTranscriptionArgs = {
  userId: string
  workspaceId: string
  recordingS3Key: string
  mimeType: string
  /** Adapter selector; defaults to the deterministic mock (no real provider in CI). */
  provider?: string
  language?: string
}

export type SummarizeMeetingArgs = {
  userId: string
  workspaceId: string
  model: MeetingModelConfig
  transcript: string
  summaryInstruction?: string | null
}

/** Injectable fetch — the runner test passes a fake; default is global fetch. */
export type MeetingFetch = typeof fetch

async function postAgents<T>(
  path: string,
  body: unknown,
  auth: { userId: string; workspaceId: string },
  timeoutMs: number,
  fetchImpl: MeetingFetch,
): Promise<T> {
  const token = await signAgentsServiceToken(auth)
  let res: Response
  try {
    res = await fetchImpl(`${agentsBaseUrl()}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    // Network / timeout / abort — never leak the cause.
    throw new Error('Сервис недоступен')
  }
  if (!res.ok) {
    // Sanitized: the HTTP status only, never the upstream body.
    throw new Error(`Ошибка сервиса (HTTP ${res.status})`)
  }
  return (await res.json()) as T
}

/**
 * POST `/transcription`: agents reads the recording bytes from S3 by key (no
 * bytes-in-payload), runs the selected adapter, returns segments. The default
 * provider is the deterministic mock — a real provider is opt-in via `provider`.
 */
export async function createTranscription(
  args: CreateTranscriptionArgs,
  fetchImpl: MeetingFetch = fetch,
): Promise<CreateTranscriptionResult> {
  const raw = await postAgents<{
    segments?: TranscriptSegmentDto[]
    language?: string | null
    durationMs?: number | null
  }>(
    '/transcription',
    {
      workspaceId: args.workspaceId,
      recordingS3Key: args.recordingS3Key,
      mimeType: args.mimeType,
      provider: args.provider ?? 'mock',
      ...(args.language ? { language: args.language } : {}),
    },
    { userId: args.userId, workspaceId: args.workspaceId },
    TRANSCRIBE_TIMEOUT_MS,
    fetchImpl,
  )
  return {
    segments: Array.isArray(raw.segments) ? raw.segments : [],
    language: raw.language ?? null,
    durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : null,
  }
}

/**
 * POST `/meeting/summarize`: agents builds the workspace model via
 * `ModelFactoryRepository.make` and one-shot summarizes the transcript.
 */
export async function summarizeMeeting(
  args: SummarizeMeetingArgs,
  fetchImpl: MeetingFetch = fetch,
): Promise<SummarizeMeetingResult> {
  const raw = await postAgents<{ summary?: string; actionItems?: string[] }>(
    '/meeting/summarize',
    {
      model: args.model,
      transcript: args.transcript,
      ...(args.summaryInstruction ? { summaryInstruction: args.summaryInstruction } : {}),
    },
    { userId: args.userId, workspaceId: args.workspaceId },
    SUMMARIZE_TIMEOUT_MS,
    fetchImpl,
  )
  return {
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    actionItems: Array.isArray(raw.actionItems)
      ? raw.actionItems.filter((s): s is string => typeof s === 'string')
      : [],
  }
}
