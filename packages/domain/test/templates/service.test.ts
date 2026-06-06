import { describe, it, expect, vi, beforeEach } from 'vitest'

import { PageTemplateScope, PageType } from '@repo/db'

import { isDomainError } from '../../src/shared/errors.ts'
import type { UnitOfWork } from '../../src/shared/unit-of-work.ts'
import type { PageService } from '../../src/pages/services/pages.service.ts'
import type { TemplateRepository } from '../../src/templates/repositories/templates.repository.ts'
import { TemplateService } from '../../src/templates/services/templates.service.ts'

function makeUow(): UnitOfWork {
  return {
    client: () => {
      throw new Error('client() should not be called from service')
    },
    transaction: async (fn) => fn(),
  }
}

function makePages(): PageService {
  return {
    create: vi.fn(async () => ({ id: 'new-page' })),
  } as unknown as PageService
}

function makeRepo(
  overrides: Partial<Record<keyof TemplateRepository, ReturnType<typeof vi.fn>>> = {},
): TemplateRepository {
  return {
    findMembership: vi.fn(async () => ({ role: 'EDITOR' })),
    findAccessiblePage: vi.fn(async () => ({
      id: 'p1',
      workspaceId: 'w1',
      createdById: 'u1',
      title: 'Source',
      icon: '📄',
      type: PageType.TEXT,
      content: { type: 'doc', content: [] },
      contentYjs: new Uint8Array(new ArrayBuffer(4)),
    })),
    searchCandidates: vi.fn(async () => []),
    listByWorkspace: vi.fn(async () => []),
    listGlobal: vi.fn(async () => []),
    findContent: vi.fn(async () => ({
      id: 't1',
      workspaceId: 'w1',
      scope: PageTemplateScope.WORKSPACE,
      title: 'Tmpl',
      icon: '📋',
      type: PageType.TEXT,
      content: { type: 'doc', content: [] },
      contentYjs: new Uint8Array(new ArrayBuffer(4)),
    })),
    createFromPage: vi.fn(async () => ({ id: 't-new' })),
    incrementUsage: vi.fn(async () => undefined),
    findForWrite: vi.fn(async () => ({
      id: 't1',
      scope: PageTemplateScope.WORKSPACE,
      workspaceId: 'w1',
    })),
    update: vi.fn(async () => ({ id: 't1' })),
    softDelete: vi.fn(async () => ({ id: 't1' })),
    create: vi.fn(async () => ({ id: 't-new' })),
    findDetail: vi.fn(async () => ({
      id: 't1',
      workspaceId: 'w1',
      scope: PageTemplateScope.WORKSPACE,
      title: 'Tmpl',
      description: null,
      icon: '📋',
      category: null,
      type: PageType.TEXT,
      content: { type: 'doc', content: [] },
    })),
    updateContent: vi.fn(async () => ({ id: 't1' })),
    ...overrides,
  } as unknown as TemplateRepository
}

describe('TemplateService.createFromPage', () => {
  let repo: TemplateRepository
  let svc: TemplateService

  beforeEach(() => {
    repo = makeRepo()
    svc = new TemplateService(repo, makeUow(), makePages())
  })

  it('creates a workspace template for a writable member', async () => {
    const res = await svc.createFromPage('u1', {
      pageId: 'p1',
      workspaceId: 'w1',
      title: 'My template',
      scope: PageTemplateScope.WORKSPACE,
    })
    expect(res).toEqual({ id: 't-new' })
    expect(repo.createFromPage).toHaveBeenCalledOnce()
  })

  it('throws NOT_FOUND when the page is inaccessible', async () => {
    repo = makeRepo({ findAccessiblePage: vi.fn(async () => null) })
    svc = new TemplateService(repo, makeUow(), makePages())
    await expect(
      svc.createFromPage('u1', {
        pageId: 'p1',
        workspaceId: 'w1',
        title: 'X',
        scope: PageTemplateScope.WORKSPACE,
      }),
    ).rejects.toMatchObject({ httpStatus: 404 })
  })

  it('forbids GLOBAL templates for normal users', async () => {
    repo = makeRepo({ findMembership: vi.fn(async () => ({ role: 'OWNER' })) })
    svc = new TemplateService(repo, makeUow(), makePages())
    await expect(
      svc.createFromPage('u1', {
        pageId: 'p1',
        workspaceId: 'w1',
        title: 'X',
        scope: PageTemplateScope.GLOBAL,
      }),
    ).rejects.toMatchObject({ httpStatus: 403 })
    expect(repo.createFromPage).not.toHaveBeenCalled()
  })

  it('forbids a non-creator read-only member from creating a workspace template', async () => {
    repo = makeRepo({
      findAccessiblePage: vi.fn(async () => ({
        id: 'p1',
        workspaceId: 'w1',
        createdById: 'someone-else',
        title: 'Source',
        icon: null,
        type: PageType.TEXT,
        content: null,
        contentYjs: null,
      })),
      findMembership: vi.fn(async () => ({ role: 'VIEWER' })),
    })
    svc = new TemplateService(repo, makeUow(), makePages())
    await expect(
      svc.createFromPage('u1', {
        pageId: 'p1',
        workspaceId: 'w1',
        title: 'X',
        scope: PageTemplateScope.WORKSPACE,
      }),
    ).rejects.toMatchObject({ httpStatus: 403 })
  })

  it('rejects when the page belongs to a different workspace', async () => {
    repo = makeRepo({
      findAccessiblePage: vi.fn(async () => ({
        id: 'p1',
        workspaceId: 'other-ws',
        createdById: 'u1',
        title: 'Source',
        icon: null,
        type: PageType.TEXT,
        content: null,
        contentYjs: null,
      })),
    })
    svc = new TemplateService(repo, makeUow(), makePages())
    await expect(
      svc.createFromPage('u1', {
        pageId: 'p1',
        workspaceId: 'w1',
        title: 'X',
        scope: PageTemplateScope.WORKSPACE,
      }),
    ).rejects.toMatchObject({ httpStatus: 400 })
  })
})

describe('TemplateService.createPageFromTemplate', () => {
  it('creates a page and increments usage', async () => {
    const repo = makeRepo()
    const pages = makePages()
    const svc = new TemplateService(repo, makeUow(), pages)
    const res = await svc.createPageFromTemplate('u1', {
      templateId: 't1',
      workspaceId: 'w1',
      parentId: null,
    })
    expect(res).toEqual({ id: 'new-page' })
    expect(pages.create).toHaveBeenCalledOnce()
    expect(repo.incrementUsage).toHaveBeenCalledWith('t1')
  })

  it('passes through the template content/title to the page create payload', async () => {
    const repo = makeRepo()
    const pages = makePages()
    const svc = new TemplateService(repo, makeUow(), pages)
    await svc.createPageFromTemplate('u1', {
      templateId: 't1',
      workspaceId: 'w1',
      parentId: 'parent-1',
    })
    expect(pages.create).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        workspaceId: 'w1',
        parentId: 'parent-1',
        title: 'Tmpl',
        type: PageType.TEXT,
        icon: '📋',
      }),
    )
  })

  it('rejects a workspace template from a different workspace', async () => {
    const repo = makeRepo({
      findContent: vi.fn(async () => ({
        id: 't1',
        workspaceId: 'other-ws',
        scope: PageTemplateScope.WORKSPACE,
        title: 'Tmpl',
        icon: null,
        type: PageType.TEXT,
        content: null,
        contentYjs: null,
      })),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    await expect(
      svc.createPageFromTemplate('u1', { templateId: 't1', workspaceId: 'w1', parentId: null }),
    ).rejects.toMatchObject({ httpStatus: 404 })
  })

  it('allows a GLOBAL template for any workspace member', async () => {
    const repo = makeRepo({
      findContent: vi.fn(async () => ({
        id: 'g1',
        workspaceId: null,
        scope: PageTemplateScope.GLOBAL,
        title: 'Global',
        icon: null,
        type: PageType.TEXT,
        content: null,
        contentYjs: null,
      })),
    })
    const pages = makePages()
    const svc = new TemplateService(repo, makeUow(), pages)
    await svc.createPageFromTemplate('u1', { templateId: 'g1', workspaceId: 'w1', parentId: null })
    expect(pages.create).toHaveBeenCalledOnce()
  })

  it('throws FORBIDDEN when the user is not a workspace member', async () => {
    const repo = makeRepo({ findMembership: vi.fn(async () => null) })
    const svc = new TemplateService(repo, makeUow(), makePages())
    await expect(
      svc.createPageFromTemplate('u1', { templateId: 't1', workspaceId: 'w1', parentId: null }),
    ).rejects.toSatisfy(isDomainError)
  })
})

describe('TemplateService.search', () => {
  it('groups and ranks candidates by relevance', async () => {
    const now = new Date('2026-01-01')
    const repo = makeRepo({
      searchCandidates: vi.fn(async () => [
        {
          id: 'g',
          workspaceId: null,
          scope: PageTemplateScope.GLOBAL,
          title: 'Plan template',
          description: null,
          icon: null,
          category: null,
          type: PageType.TEXT,
          usageCount: 0,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'w',
          workspaceId: 'w1',
          scope: PageTemplateScope.WORKSPACE,
          title: 'My plan',
          description: null,
          icon: null,
          category: null,
          type: PageType.TEXT,
          usageCount: 0,
          createdAt: now,
          updatedAt: now,
        },
      ]),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    const res = await svc.search('u1', { workspaceId: 'w1', query: 'plan' })
    expect(res.workspaceTemplates.map((t) => t.id)).toEqual(['w'])
    expect(res.globalTemplates.map((t) => t.id)).toEqual(['g'])
  })
})

describe('TemplateService.delete / update', () => {
  it('refuses to mutate a GLOBAL template', async () => {
    const repo = makeRepo({
      findForWrite: vi.fn(async () => ({
        id: 'g1',
        scope: PageTemplateScope.GLOBAL,
        workspaceId: null,
      })),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    await expect(svc.delete('u1', { templateId: 'g1', workspaceId: 'w1' })).rejects.toMatchObject({
      httpStatus: 403,
    })
  })

  it('soft-deletes a workspace template for a writable member', async () => {
    const repo = makeRepo()
    const svc = new TemplateService(repo, makeUow(), makePages())
    const res = await svc.delete('u1', { templateId: 't1', workspaceId: 'w1' })
    expect(res).toEqual({ count: 1 })
    expect(repo.softDelete).toHaveBeenCalledWith('u1', 't1')
  })
})

describe('TemplateService.create', () => {
  it('creates an empty workspace template for a writable member', async () => {
    const repo = makeRepo({
      findMembership: vi.fn(async () => ({ role: 'EDITOR' })),
      create: vi.fn(async () => ({ id: 't-new' })),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    const res = await svc.create('u1', { workspaceId: 'w1', title: 'Blank' })
    expect(res).toEqual({ id: 't-new' })
    expect(repo.create).toHaveBeenCalledOnce()
  })

  it('rejects a non-member', async () => {
    const repo = makeRepo({ findMembership: vi.fn(async () => null) })
    const svc = new TemplateService(repo, makeUow(), makePages())
    await expect(svc.create('u1', { workspaceId: 'w1', title: 'Blank' })).rejects.toMatchObject({
      name: 'DomainError',
      httpStatus: 403,
    })
  })
})

describe('TemplateService.getById', () => {
  it('returns a workspace template detail for a member', async () => {
    const detail = {
      id: 't1',
      workspaceId: 'w1',
      scope: PageTemplateScope.WORKSPACE,
      title: 'T',
      description: null,
      icon: null,
      category: null,
      type: PageType.TEXT,
      content: { type: 'doc', content: [] },
    }
    const repo = makeRepo({
      findMembership: vi.fn(async () => ({ role: 'EDITOR' })),
      findDetail: vi.fn(async () => detail),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    await expect(svc.getById('u1', { templateId: 't1', workspaceId: 'w1' })).resolves.toEqual(detail)
  })

  it('404s when the template is missing', async () => {
    const repo = makeRepo({
      findMembership: vi.fn(async () => ({ role: 'EDITOR' })),
      findDetail: vi.fn(async () => null),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    await expect(
      svc.getById('u1', { templateId: 't1', workspaceId: 'w1' }),
    ).rejects.toMatchObject({ httpStatus: 404 })
  })
})

describe('TemplateService.updateContent', () => {
  it('updates content for a writable member, forwarding derived bytes', async () => {
    const repo = makeRepo({
      findForWrite: vi.fn(async () => ({ id: 't1', scope: PageTemplateScope.WORKSPACE, workspaceId: 'w1' })),
      findMembership: vi.fn(async () => ({ role: 'EDITOR' })),
      updateContent: vi.fn(async () => ({ id: 't1' })),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    const bytes = new Uint8Array(new ArrayBuffer(4))
    const res = await svc.updateContent(
      'u1',
      { templateId: 't1', workspaceId: 'w1', content: { type: 'doc', content: [] } },
      bytes,
    )
    expect(res).toEqual({ id: 't1' })
    expect(repo.updateContent).toHaveBeenCalledWith('u1', 't1', { type: 'doc', content: [] }, bytes)
  })

  it('forbids editing a GLOBAL template', async () => {
    const repo = makeRepo({
      findForWrite: vi.fn(async () => ({ id: 't1', scope: PageTemplateScope.GLOBAL, workspaceId: null })),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    await expect(
      svc.updateContent('u1', { templateId: 't1', workspaceId: 'w1', content: {} }, null),
    ).rejects.toMatchObject({ httpStatus: 403 })
  })
})
