import { prisma } from '@repo/db'
import { storage } from '@repo/storage'

import { domain } from '@/lib/domain'
import { resolveProviderConnection } from '@/lib/chat/provider-connection'

type JobKind = 'import' | 'export' | 'meeting'

// Fire-and-forget background processing inside the web process. Crash recovery
// is a lazy reclaim (heartbeat > 10 min → re-queue/re-UPLOAD + re-kick): import/
// export through job.list, meetings through the read queries the transcript page
// polls (meeting.getByPage/getById → reclaimIfStalled). Re-runs are idempotent:
// import via ImportMapping, export rebuilds the zip, meeting via the
// UPLOADED→TRANSCRIBING atomic claim (which clears prior-run children first).
export function kickJob(jobId: string, kind: JobKind): void {
  void run(jobId, kind).catch((err) => {
    console.error('[jobs] runner crashed', { jobId, kind, err })
  })
}

/**
 * The summarize provider resolver for the meeting runner — the 9D готовность
 * guarantee verbatim: load the workspace's OWN `defaultModel`; return null when
 * unset (the runner then FAILs) — NEVER a hidden global provider.
 */
async function resolveMeetingProvider(workspaceId: string) {
  const settings = await prisma.workspaceAiSettings.findUnique({
    where: { workspaceId },
    include: { defaultModel: { include: { provider: true } } },
  })
  if (!settings?.defaultModel) return null
  return {
    model: {
      // The agents service matches providers by the lowercased ModelProviderEnum
      // value; AiProviderKind shares those names (the inline-handler precedent).
      provider: settings.defaultModel.provider.kind.toLowerCase(),
      name: settings.defaultModel.slug,
      connection: resolveProviderConnection(settings.defaultModel.provider),
      settings: { temperature: settings.temperature, topP: settings.topP },
    },
  }
}

async function run(jobId: string, kind: JobKind): Promise<void> {
  if (kind === 'export') {
    const { processExportJob } = await import('./process-export-job')
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
    await processExportJob({ prisma, storage, database: domain.database, baseUrl }, jobId)
  } else if (kind === 'meeting') {
    const { processMeetingJob } = await import('./process-meeting-job')
    const { createTranscription, summarizeMeeting } = await import('@/lib/agents/meeting-client')
    await processMeetingJob(jobId, {
      prisma,
      createTranscription,
      summarizeMeeting,
      resolveProvider: resolveMeetingProvider,
    })
  } else {
    const { processImportJob } = await import('./process-import-job')
    await processImportJob(
      { prisma, storage, pages: domain.pages, database: domain.database },
      jobId,
    )
  }
}
