import { prisma } from '@repo/db'
import { storage } from '@repo/storage'

import { domain } from '@/lib/domain'

// Fire-and-forget background processing inside the web process. Crash recovery
// is the lazy reclaim in job.list (heartbeat > 10 min → re-queue + re-kick);
// import re-runs are idempotent via ImportMapping, export re-runs rebuild the zip.
export function kickJob(jobId: string, kind: 'import' | 'export'): void {
  void run(jobId, kind).catch((err) => {
    console.error('[jobs] runner crashed', { jobId, kind, err })
  })
}

async function run(jobId: string, kind: 'import' | 'export'): Promise<void> {
  if (kind === 'export') {
    const { processExportJob } = await import('./process-export-job')
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
    await processExportJob({ prisma, storage, database: domain.database, baseUrl }, jobId)
  } else {
    const { processImportJob } = await import('./process-import-job')
    await processImportJob(
      { prisma, storage, pages: domain.pages, database: domain.database },
      jobId,
    )
  }
}
