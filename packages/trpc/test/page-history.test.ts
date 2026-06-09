import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@repo/db'

import { pageRouter } from '../src/routers/page'
import { createCallerFactory } from '../src/trpc'

// Real-DB integration test for the page-history sub-router (list / preview /
// restore), all EDIT-gated. Uses an email-suffix fixture namespace so it
// self-cleans. Requires `docker compose up -d` (postgres).

const EMAIL_SUFFIX = '+page-history-test@anynote.dev'

async function cleanFixtures() {
  await prisma.pageRevision.deleteMany({
    where: { page: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } } },
  })
  await prisma.page.deleteMany({
    where: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } },
  })
  await prisma.workspaceMember.deleteMany({
    where: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } },
  })
  await prisma.workspace.deleteMany({
    where: { createdBy: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
}

async function makeUser(label: string) {
  return prisma.user.create({
    data: {
      email: `${label}${EMAIL_SUFFIX}`,
      emailVerified: true,
      name: label,
      firstName: label,
      lastName: 'Test',
    },
  })
}

function makeCaller(userId: string) {
  return createCallerFactory(pageRouter)({
    prisma,
    user: {
      id: userId,
      email: 'x',
      firstName: 'T',
      lastName: 'U',
      emailVerified: true,
    } as never,
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
  })
}

// owner (OWNER) + editor (EDITOR) + viewer (VIEWER) + a TEXT page with content,
// plus one EDIT revision carrying an "old" content snapshot.
async function seed() {
  const owner = await makeUser('owner')
  const editor = await makeUser('editor')
  const viewer = await makeUser('viewer')
  const ws = await prisma.workspace.create({
    data: { name: 'HistoryWS', createdById: owner.id },
    select: { id: true },
  })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
      { workspaceId: ws.id, userId: editor.id, role: 'EDITOR' },
      { workspaceId: ws.id, userId: viewer.id, role: 'VIEWER' },
    ],
  })
  const page = await prisma.page.create({
    data: {
      workspaceId: ws.id,
      type: 'TEXT',
      title: 'Current title',
      content: { type: 'doc', marker: 'current' },
      createdById: owner.id,
    },
    select: { id: true },
  })
  const revision = await prisma.pageRevision.create({
    data: {
      pageId: page.id,
      actorId: owner.id,
      action: 'EDIT',
      content: { type: 'doc', marker: 'old' },
      metadata: { title: 'Old title' },
    },
    select: { id: true },
  })
  return { owner, editor, viewer, ws, page, revision }
}

describe('page.history', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('listRevisions returns metadata-only rows for an editor (no content blobs)', async () => {
    const { editor, page, revision } = await seed()
    const caller = makeCaller(editor.id)
    const rows = await caller.history.listRevisions({ pageId: page.id })
    expect(rows.length).toBe(1)
    expect(rows[0]!.id).toBe(revision.id)
    expect(rows[0]!.action).toBe('EDIT')
    expect(rows[0]).not.toHaveProperty('content')
    expect(rows[0]).not.toHaveProperty('contentYjs')
  })

  it('getRevisionPreview returns the full content for an editor', async () => {
    const { editor, page, revision } = await seed()
    const caller = makeCaller(editor.id)
    const preview = await caller.history.getRevisionPreview({
      pageId: page.id,
      revisionId: revision.id,
    })
    expect(preview.content).toEqual({ type: 'doc', marker: 'old' })
  })

  it('restoreRevision writes the snapshot back AND records a RESTORE revision', async () => {
    const { owner, page, revision } = await seed()
    const caller = makeCaller(owner.id)
    const result = await caller.history.restoreRevision({
      pageId: page.id,
      revisionId: revision.id,
    })
    expect(result.id).toBe(page.id)

    const updated = await prisma.page.findUnique({
      where: { id: page.id },
      select: { content: true },
    })
    expect(updated!.content).toEqual({ type: 'doc', marker: 'old' })

    const revisions = await prisma.pageRevision.findMany({
      where: { pageId: page.id },
      orderBy: { createdAt: 'desc' },
      select: { action: true, actorId: true },
    })
    // A new RESTORE revision was appended (history is never erased).
    expect(revisions.some((r) => r.action === 'RESTORE' && r.actorId === owner.id)).toBe(true)
    expect(revisions.length).toBe(2)
  })

  it('a non-editor (VIEWER role, not the creator) → FORBIDDEN on list/preview/restore', async () => {
    const { viewer, page, revision } = await seed()
    const caller = makeCaller(viewer.id)
    await expect(caller.history.listRevisions({ pageId: page.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(
      caller.history.getRevisionPreview({ pageId: page.id, revisionId: revision.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      caller.history.restoreRevision({ pageId: page.id, revisionId: revision.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('a user who lost workspace access → NOT_FOUND (no snapshot leak)', async () => {
    const { editor, page, revision, ws } = await seed()
    // Editor is removed from the workspace.
    await prisma.workspaceMember.deleteMany({ where: { workspaceId: ws.id, userId: editor.id } })
    const caller = makeCaller(editor.id)
    await expect(
      caller.history.getRevisionPreview({ pageId: page.id, revisionId: revision.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
