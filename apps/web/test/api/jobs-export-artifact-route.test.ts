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
      if (key !== 'exports/test-artifact.zip') throw new Error('missing')
      return Readable.from([Buffer.from('PK-test')])
    },
  },
}))

import { GET } from '@/app/api/jobs/export/[jobId]/artifact/route'

const EMAIL_SUFFIX = '+artifact-route-test@anynote.dev'

async function cleanFixtures() {
  const byWs = { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } }
  await prisma.exportJob.deleteMany({ where: byWs })
  await prisma.file.deleteMany({ where: { user: { email: { contains: EMAIL_SUFFIX } } } })
  await prisma.workspaceMember.deleteMany({ where: byWs })
  await prisma.workspace.deleteMany({ where: { createdBy: { email: { contains: EMAIL_SUFFIX } } } })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
}

async function seed(opts: { expired?: boolean } = {}) {
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
  const ws = await prisma.workspace.create({ data: { name: 'ArtWS', createdById: owner.id } })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
      { workspaceId: ws.id, userId: other.id, role: 'ADMIN' },
    ],
  })
  const file = await prisma.file.create({
    data: {
      userId: owner.id,
      workspaceId: ws.id,
      name: 'anynote-export',
      ext: 'zip',
      fileSize: 7n,
      mimeType: 'application/zip',
      hash: 'art-h',
      path: 'exports/test-artifact.zip',
      status: 'ACTIVE',
      isPublic: false,
      expiresAt: new Date(Date.now() + (opts.expired ? -1000 : 1000 * 60 * 60)),
    },
  })
  const job = await prisma.exportJob.create({
    data: {
      workspaceId: ws.id,
      userId: owner.id,
      scope: 'WORKSPACE',
      format: 'MARKDOWN_ZIP',
      status: 'DONE',
      artifacts: { create: { fileId: file.id } },
    },
  })
  return { owner, other, job }
}

function call(jobId: string) {
  return GET(new Request('http://t/api') as never, { params: Promise.resolve({ jobId }) })
}

describe('GET /api/jobs/export/[jobId]/artifact', () => {
  beforeEach(async () => {
    sessionUserId.current = null
    await cleanFixtures()
  })
  afterAll(cleanFixtures)

  it('streams the zip to the job owner', async () => {
    const { owner, job } = await seed()
    sessionUserId.current = owner.id
    const res = await call(job.id)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    expect(await res.text()).toBe('PK-test')
  })

  it('returns 404 for a workspace ADMIN who does not own the job', async () => {
    const { other, job } = await seed()
    sessionUserId.current = other.id
    const res = await call(job.id)
    expect(res.status).toBe(404)
  })

  it('returns 404 after the artifact expired', async () => {
    const { owner, job } = await seed({ expired: true })
    sessionUserId.current = owner.id
    const res = await call(job.id)
    expect(res.status).toBe(404)
  })

  it('returns 401 without a session', async () => {
    const { job } = await seed()
    const res = await call(job.id)
    expect(res.status).toBe(401)
  })
})
