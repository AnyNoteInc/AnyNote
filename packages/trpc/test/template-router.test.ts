import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma, PageTemplateScope, PageType } from '@repo/db'

import { templateRouter } from '../src/routers/template'
import { createCallerFactory } from '../src/trpc'

// Real-DB integration test for the full template stack (router → domain →
// Prisma). Uses an email-suffix fixture namespace so it self-cleans and never
// touches real data. Requires `docker compose up -d` (postgres) and a seeded
// `personal` plan, like the other integration tests in this folder.

const EMAIL_SUFFIX = '+template-router-test@anynote.dev'

async function cleanFixtures() {
  await prisma.pageTemplate.deleteMany({
    where: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } },
  })
  // Global templates created by fixture users carry no workspace link, so clean
  // them by creator instead.
  const users = await prisma.user.findMany({
    where: { email: { contains: EMAIL_SUFFIX } },
    select: { id: true },
  })
  if (users.length > 0) {
    await prisma.pageTemplate.deleteMany({
      where: { createdById: { in: users.map((u) => u.id) } },
    })
  }
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

async function makeWorkspaceWithOwner(ownerId: string, name = 'WS') {
  const ws = await prisma.workspace.create({
    data: { name, createdById: ownerId },
    select: { id: true },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: ownerId, role: 'OWNER' },
  })
  return ws
}

async function makePage(workspaceId: string, ownerId: string, title: string) {
  return prisma.page.create({
    data: {
      workspaceId,
      title,
      type: 'TEXT',
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      createdById: ownerId,
      updatedById: ownerId,
    },
    select: { id: true },
  })
}

function makeCaller(userId: string) {
  return createCallerFactory(templateRouter)({
    prisma,
    user: { id: userId },
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost:3000',
  })
}

describe('template router (integration)', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('createFromPage creates a WORKSPACE template copying page type/content', async () => {
    const owner = await makeUser('a')
    const ws = await makeWorkspaceWithOwner(owner.id)
    const page = await makePage(ws.id, owner.id, 'My doc')
    const caller = makeCaller(owner.id)

    const { id } = await caller.createFromPage({
      pageId: page.id,
      workspaceId: ws.id,
      title: 'Reusable doc',
      description: 'A handy starting point',
      category: 'Docs',
      scope: PageTemplateScope.WORKSPACE,
    })

    const row = await prisma.pageTemplate.findUniqueOrThrow({ where: { id } })
    expect(row.scope).toBe(PageTemplateScope.WORKSPACE)
    expect(row.workspaceId).toBe(ws.id)
    expect(row.title).toBe('Reusable doc')
    expect(row.description).toBe('A handy starting point')
    expect(row.type).toBe(PageType.TEXT)
    expect(row.content).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
    expect(row.usageCount).toBe(0)
  })

  it('forbids a normal user from creating a GLOBAL template', async () => {
    const owner = await makeUser('b')
    const ws = await makeWorkspaceWithOwner(owner.id)
    const page = await makePage(ws.id, owner.id, 'Doc')
    const caller = makeCaller(owner.id)

    await expect(
      caller.createFromPage({
        pageId: page.id,
        workspaceId: ws.id,
        title: 'Global tmpl',
        scope: PageTemplateScope.GLOBAL,
      }),
    ).rejects.toThrow(/глобальных шаблонов/i)
  })

  it('search returns workspace and global templates, grouped', async () => {
    const owner = await makeUser('c')
    const ws = await makeWorkspaceWithOwner(owner.id)
    const page = await makePage(ws.id, owner.id, 'Doc')
    const caller = makeCaller(owner.id)

    await caller.createFromPage({
      pageId: page.id,
      workspaceId: ws.id,
      title: 'Project plan',
      scope: PageTemplateScope.WORKSPACE,
    })
    // Seed a GLOBAL template directly (normal users can't create these).
    await prisma.pageTemplate.create({
      data: {
        scope: PageTemplateScope.GLOBAL,
        title: 'Global project brief',
        type: 'TEXT',
        createdById: owner.id,
      },
    })

    const res = await caller.search({ workspaceId: ws.id, query: 'project' })
    expect(res.workspaceTemplates.map((t) => t.title)).toContain('Project plan')
    expect(res.globalTemplates.map((t) => t.title)).toContain('Global project brief')
  })

  it('createPageFromTemplate creates a page and increments usageCount', async () => {
    const owner = await makeUser('d')
    const ws = await makeWorkspaceWithOwner(owner.id)
    const page = await makePage(ws.id, owner.id, 'Doc')
    const caller = makeCaller(owner.id)

    const { id: templateId } = await caller.createFromPage({
      pageId: page.id,
      workspaceId: ws.id,
      title: 'Starter',
      scope: PageTemplateScope.WORKSPACE,
    })

    const { id: newPageId } = await caller.createPageFromTemplate({
      templateId,
      workspaceId: ws.id,
      parentId: null,
    })

    const created = await prisma.page.findUniqueOrThrow({ where: { id: newPageId } })
    expect(created.workspaceId).toBe(ws.id)
    expect(created.title).toBe('Starter')
    expect(created.type).toBe(PageType.TEXT)

    const tmpl = await prisma.pageTemplate.findUniqueOrThrow({ where: { id: templateId } })
    expect(tmpl.usageCount).toBe(1)
  })

  it('createPageFromTemplate honors an overridden title', async () => {
    const owner = await makeUser('e')
    const ws = await makeWorkspaceWithOwner(owner.id)
    const page = await makePage(ws.id, owner.id, 'Doc')
    const caller = makeCaller(owner.id)
    const { id: templateId } = await caller.createFromPage({
      pageId: page.id,
      workspaceId: ws.id,
      title: 'Starter',
      scope: PageTemplateScope.WORKSPACE,
    })

    const { id: newPageId } = await caller.createPageFromTemplate({
      templateId,
      workspaceId: ws.id,
      parentId: null,
      title: 'Custom name',
    })
    const created = await prisma.page.findUniqueOrThrow({ where: { id: newPageId } })
    expect(created.title).toBe('Custom name')
  })

  it('a WORKSPACE template is not usable from another workspace', async () => {
    // Two separate owners (each with their own single workspace) so neither
    // trips the per-plan workspace limit. The author of wsA's template is also
    // a member of wsB, but the template must still be invisible there.
    const ownerA = await makeUser('f')
    const ownerB = await makeUser('h')
    const wsA = await makeWorkspaceWithOwner(ownerA.id, 'A')
    const wsB = await makeWorkspaceWithOwner(ownerB.id, 'B')
    await prisma.workspaceMember.create({
      data: { workspaceId: wsB.id, userId: ownerA.id, role: 'EDITOR' },
    })
    const page = await makePage(wsA.id, ownerA.id, 'Doc')
    const caller = makeCaller(ownerA.id)

    const { id: templateId } = await caller.createFromPage({
      pageId: page.id,
      workspaceId: wsA.id,
      title: 'A-only',
      scope: PageTemplateScope.WORKSPACE,
    })

    await expect(
      caller.createPageFromTemplate({ templateId, workspaceId: wsB.id, parentId: null }),
    ).rejects.toThrow(/Шаблон не найден/i)
  })

  it('search excludes soft-deleted templates', async () => {
    const owner = await makeUser('g')
    const ws = await makeWorkspaceWithOwner(owner.id)
    const page = await makePage(ws.id, owner.id, 'Doc')
    const caller = makeCaller(owner.id)
    const { id } = await caller.createFromPage({
      pageId: page.id,
      workspaceId: ws.id,
      title: 'Deletable',
      scope: PageTemplateScope.WORKSPACE,
    })

    await caller.delete({ templateId: id, workspaceId: ws.id })

    const res = await caller.search({ workspaceId: ws.id, query: 'Deletable' })
    expect(res.workspaceTemplates).toHaveLength(0)
  })
})
