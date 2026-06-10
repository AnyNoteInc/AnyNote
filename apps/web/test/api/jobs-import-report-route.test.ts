import { Readable } from 'node:stream'

import { prisma } from '@repo/db'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const sessionUserId = vi.hoisted(() => ({ current: null as string | null }))

vi.mock('@/lib/get-session', () => ({
  getSession: async () => (sessionUserId.current ? { user: { id: sessionUserId.current } } : null),
}))

vi.mock('@repo/storage', () => ({
  storage: {
    get: async (key: string) => {
      if (key !== 'imports/test-report.txt') throw new Error('missing')
      return Readable.from([Buffer.from('journal-test')])
    },
  },
}))

import { GET } from '@/app/api/jobs/import/[jobId]/report/route'

const EMAIL_SUFFIX = '+import-report-test@anynote.dev'

async function cleanFixtures() {
  const byWs = { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } }
  await prisma.importJob.deleteMany({ where: byWs })
  await prisma.file.deleteMany({ where: { user: { email: { contains: EMAIL_SUFFIX } } } })
  await prisma.workspaceMember.deleteMany({ where: byWs })
  await prisma.workspace.deleteMany({ where: { createdBy: { email: { contains: EMAIL_SUFFIX } } } })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
}

async function seed(opts: { failed?: boolean } = {}) {
  const owner = await prisma.user.create({
    data: {
      email: `owner${EMAIL_SUFFIX}`,
      emailVerified: true,
      name: 'o',
      firstName: 'O',
      lastName: 'T',
    },
  })
  const other = await prisma.user.create({
    data: {
      email: `other${EMAIL_SUFFIX}`,
      emailVerified: true,
      name: 'x',
      firstName: 'X',
      lastName: 'T',
    },
  })
  const ws = await prisma.workspace.create({ data: { name: 'RepWS', createdById: owner.id } })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
      { workspaceId: ws.id, userId: other.id, role: 'ADMIN' },
    ],
  })
  const sourceFile = await prisma.file.create({
    data: {
      userId: owner.id,
      workspaceId: ws.id,
      name: 'notion-export',
      ext: 'zip',
      fileSize: 1n,
      mimeType: 'application/zip',
      hash: 'rep-src-h',
      path: 'imports/test-source.zip',
      status: 'ACTIVE',
      isPublic: false,
    },
  })
  // REPORT files live outside any workspace and never expire.
  const reportFile = await prisma.file.create({
    data: {
      userId: owner.id,
      workspaceId: null,
      name: 'import-report',
      ext: 'txt',
      fileSize: 12n,
      mimeType: 'text/plain',
      hash: 'rep-h',
      path: 'imports/test-report.txt',
      status: 'ACTIVE',
      isPublic: false,
    },
  })
  const job = await prisma.importJob.create({
    data: {
      workspaceId: ws.id,
      userId: owner.id,
      format: 'ZIP',
      source: 'NOTION',
      status: opts.failed ? 'FAILED' : 'DONE',
      error: opts.failed ? 'boom' : null,
      artifacts: {
        create: [
          { fileId: sourceFile.id, kind: 'SOURCE' },
          { fileId: reportFile.id, kind: 'REPORT' },
        ],
      },
    },
  })
  return { owner, other, job }
}

function call(jobId: string) {
  return GET(new Request('http://t/api') as never, { params: Promise.resolve({ jobId }) })
}

describe('GET /api/jobs/import/[jobId]/report', () => {
  beforeEach(async () => {
    sessionUserId.current = null
    await cleanFixtures()
  })
  afterAll(cleanFixtures)

  it('streams the report txt to the job owner', async () => {
    const { owner, job } = await seed()
    sessionUserId.current = owner.id
    const res = await call(job.id)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await res.text()).toBe('journal-test')
  })

  it('returns 404 for a workspace ADMIN who does not own the job', async () => {
    const { other, job } = await seed()
    sessionUserId.current = other.id
    const res = await call(job.id)
    expect(res.status).toBe(404)
  })

  it('streams the report for a FAILED job (no status filter)', async () => {
    const { owner, job } = await seed({ failed: true })
    sessionUserId.current = owner.id
    const res = await call(job.id)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('journal-test')
  })

  it('returns 401 without a session', async () => {
    const { job } = await seed()
    const res = await call(job.id)
    expect(res.status).toBe(401)
  })
})
