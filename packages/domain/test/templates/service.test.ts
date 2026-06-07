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
    create: vi.fn(async () => ({ id: 'backing-1' })),
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
    listTags: vi.fn(async () => []),
    marketplaceCandidates: vi.fn(async () => []),
    countExistingTags: vi.fn(async () => 0),
    findContent: vi.fn(async () => ({
      id: 't1',
      workspaceId: 'w1',
      scope: PageTemplateScope.WORKSPACE,
      title: 'Tmpl',
      icon: '📋',
      type: PageType.TEXT,
      content: { type: 'doc', content: [] },
      contentYjs: new Uint8Array(new ArrayBuffer(4)),
      backingPageId: null,
    })),
    findBackingPageContent: vi.fn(async () => null),
    softDeleteBackingPage: vi.fn(async () => undefined),
    createFromPage: vi.fn(async () => ({ id: 't-new' })),
    incrementUsage: vi.fn(async () => undefined),
    // Default: actor 'u1' is the creator of template 't1'
    findForWrite: vi.fn(async () => ({
      id: 't1',
      scope: PageTemplateScope.WORKSPACE,
      workspaceId: 'w1',
      createdById: 'u1',
      backingPageId: null,
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
      type: PageType.TEXT,
      content: { type: 'doc', content: [] },
      backingPageId: 'bp1',
      createdById: 'u1',
    })),
    findBackingPageForTemplate: vi.fn(async () => ({
      id: 'bp1',
      type: PageType.TEXT,
      contentYjs: null,
    })),
    updateContent: vi.fn(async () => ({ id: 't1' })),
    linkTags: vi.fn(async () => undefined),
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

  it('allows any workspace member to create a GLOBAL template', async () => {
    repo = makeRepo({ findMembership: vi.fn(async () => ({ role: 'EDITOR' })) })
    svc = new TemplateService(repo, makeUow(), makePages())
    const res = await svc.createFromPage('u1', {
      pageId: 'p1',
      workspaceId: 'w1',
      title: 'X',
      scope: PageTemplateScope.GLOBAL,
    })
    expect(res).toEqual({ id: 't-new' })
    expect(repo.createFromPage).toHaveBeenCalledOnce()
  })

  it('allows any accessible-page owner to create a GLOBAL template (no role required)', async () => {
    repo = makeRepo({ findMembership: vi.fn(async () => null) })
    svc = new TemplateService(repo, makeUow(), makePages())
    const res = await svc.createFromPage('u1', {
      pageId: 'p1',
      workspaceId: 'w1',
      title: 'X',
      scope: PageTemplateScope.GLOBAL,
    })
    expect(res).toEqual({ id: 't-new' })
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
    expect(res).toEqual({ id: 'backing-1' })
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
        backingPageId: null,
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
        backingPageId: null,
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

  it('uses backing page live content (FRESH) when backingPageId is set', async () => {
    const STALE = new Uint8Array([1, 2, 3, 4])
    const FRESH = new Uint8Array([9, 8, 7, 6])
    const repo = makeRepo({
      findContent: vi.fn(async () => ({
        id: 't1',
        workspaceId: 'w1',
        scope: PageTemplateScope.WORKSPACE,
        title: 'Tmpl',
        icon: null,
        type: PageType.TEXT,
        content: { type: 'doc', content: [] },
        contentYjs: STALE,
        backingPageId: 'bp1',
      })),
      findBackingPageContent: vi.fn(async () => ({
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
        contentYjs: FRESH,
      })),
    })
    const pages = makePages()
    const svc = new TemplateService(repo, makeUow(), pages)
    await svc.createPageFromTemplate('u1', { templateId: 't1', workspaceId: 'w1', parentId: null })
    expect(repo.findBackingPageContent).toHaveBeenCalledWith('bp1')
    // The page must be created with FRESH contentYjs, not STALE
    expect(pages.create).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ contentYjs: FRESH }),
    )
    const call = (pages.create as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(call.contentYjs).toBe(FRESH)
    expect(call.contentYjs).not.toBe(STALE)
  })

  it('falls back to template contentYjs when backingPageId is null (e.g. seeded GLOBAL)', async () => {
    const TEMPLATE_BYTES = new Uint8Array([5, 5, 5, 5])
    const repo = makeRepo({
      findContent: vi.fn(async () => ({
        id: 'g1',
        workspaceId: null,
        scope: PageTemplateScope.GLOBAL,
        title: 'Global',
        icon: null,
        type: PageType.TEXT,
        content: null,
        contentYjs: TEMPLATE_BYTES,
        backingPageId: null,
      })),
      findBackingPageContent: vi.fn(async () => null),
    })
    const pages = makePages()
    const svc = new TemplateService(repo, makeUow(), pages)
    await svc.createPageFromTemplate('u1', { templateId: 'g1', workspaceId: 'w1', parentId: null })
    // Must NOT call findBackingPageContent when backingPageId is null
    expect(repo.findBackingPageContent).not.toHaveBeenCalled()
    expect(pages.create).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ contentYjs: TEMPLATE_BYTES }),
    )
  })
})

describe('TemplateService.search', () => {
  it('groups and ranks candidates by relevance', async () => {
    const now = new Date('2026-01-01')
    const baseSummary = {
      description: null,
      icon: null,
      type: PageType.TEXT,
      usageCount: 0,
      averageRating: 0,
      ratingCount: 0,
      previewColor: null,
      tags: [],
      author: { name: 'AnyNote' },
      createdById: null,
      createdAt: now,
      updatedAt: now,
    }
    const repo = makeRepo({
      searchCandidates: vi.fn(async () => [
        {
          ...baseSummary,
          id: 'g',
          workspaceId: null,
          scope: PageTemplateScope.GLOBAL,
          title: 'Plan template',
        },
        {
          ...baseSummary,
          id: 'w',
          workspaceId: 'w1',
          scope: PageTemplateScope.WORKSPACE,
          title: 'My plan',
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
  it('refuses to mutate a GLOBAL template when actor is not its creator', async () => {
    const repo = makeRepo({
      findForWrite: vi.fn(async () => ({
        id: 'g1',
        scope: PageTemplateScope.GLOBAL,
        workspaceId: null,
        createdById: 'other-user',
      })),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    await expect(svc.delete('u1', { templateId: 'g1', workspaceId: 'w1' })).rejects.toMatchObject({
      httpStatus: 403,
    })
  })

  it('allows the creator of a GLOBAL template to delete it', async () => {
    const repo = makeRepo({
      findForWrite: vi.fn(async () => ({
        id: 'g1',
        scope: PageTemplateScope.GLOBAL,
        workspaceId: null,
        createdById: 'u1',
      })),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    const res = await svc.delete('u1', { templateId: 'g1', workspaceId: 'w1' })
    expect(res).toEqual({ count: 1 })
  })

  it('soft-deletes a workspace template for the creator', async () => {
    const repo = makeRepo()
    const svc = new TemplateService(repo, makeUow(), makePages())
    const res = await svc.delete('u1', { templateId: 't1', workspaceId: 'w1' })
    expect(res).toEqual({ count: 1 })
    expect(repo.softDelete).toHaveBeenCalledWith('u1', 't1')
  })

  it('forbids editing a workspace template by non-creator non-admin EDITOR', async () => {
    const repo = makeRepo({
      findForWrite: vi.fn(async () => ({
        id: 't1',
        scope: PageTemplateScope.WORKSPACE,
        workspaceId: 'w1',
        createdById: 'other-user',
      })),
      findMembership: vi.fn(async () => ({ role: 'EDITOR' })),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    await expect(svc.delete('u1', { templateId: 't1', workspaceId: 'w1' })).rejects.toMatchObject({
      httpStatus: 403,
    })
  })

  it('allows OWNER to edit a workspace template they did not create', async () => {
    const repo = makeRepo({
      findForWrite: vi.fn(async () => ({
        id: 't1',
        scope: PageTemplateScope.WORKSPACE,
        workspaceId: 'w1',
        createdById: 'other-user',
      })),
      findMembership: vi.fn(async () => ({ role: 'OWNER' })),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    const res = await svc.delete('u1', { templateId: 't1', workspaceId: 'w1' })
    expect(res).toEqual({ count: 1 })
  })

  it('soft-deletes the backing page when the template has one', async () => {
    const repo = makeRepo({
      findForWrite: vi.fn(async () => ({
        id: 't1',
        scope: PageTemplateScope.WORKSPACE,
        workspaceId: 'w1',
        createdById: 'u1',
        backingPageId: 'bp1',
      })),
      softDeleteBackingPage: vi.fn(async () => undefined),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    const res = await svc.delete('u1', { templateId: 't1', workspaceId: 'w1' })
    expect(res).toEqual({ count: 1 })
    expect(repo.softDelete).toHaveBeenCalledWith('u1', 't1')
    expect(repo.softDeleteBackingPage).toHaveBeenCalledWith('bp1')
  })

  it('does not call softDeleteBackingPage when template has no backing page', async () => {
    const repo = makeRepo({
      findForWrite: vi.fn(async () => ({
        id: 't1',
        scope: PageTemplateScope.WORKSPACE,
        workspaceId: 'w1',
        createdById: 'u1',
        backingPageId: null,
      })),
      softDeleteBackingPage: vi.fn(async () => undefined),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    await svc.delete('u1', { templateId: 't1', workspaceId: 'w1' })
    expect(repo.softDeleteBackingPage).not.toHaveBeenCalled()
  })

  it('update rejects unknown tag id', async () => {
    const repo = makeRepo({
      // countExistingTags returns 0 but 1 tagId was supplied → should throw BAD_REQUEST
      countExistingTags: vi.fn(async () => 0),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    await expect(
      svc.update('u1', {
        templateId: 't1',
        workspaceId: 'w1',
        tagIds: ['00000000-0000-0000-0000-000000000099'],
      }),
    ).rejects.toMatchObject({ httpStatus: 400 })
    expect(repo.update).not.toHaveBeenCalled()
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
  it('returns a workspace template detail for a member including canEdit', async () => {
    const detail = {
      id: 't1',
      workspaceId: 'w1',
      scope: PageTemplateScope.WORKSPACE,
      title: 'T',
      description: null,
      icon: null,
      type: PageType.TEXT,
      content: { type: 'doc', content: [] },
      backingPageId: 'bp1',
      createdById: 'u1',
    }
    const repo = makeRepo({
      findMembership: vi.fn(async () => ({ role: 'EDITOR' })),
      findDetail: vi.fn(async () => detail),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    const result = await svc.getById('u1', { templateId: 't1', workspaceId: 'w1' })
    // canEdit is computed by the service; all repo fields must be forwarded
    expect(result).toMatchObject(detail)
    expect(typeof result.canEdit).toBe('boolean')
  })

  it('returns canEdit: true for a GLOBAL template when actor === createdById', async () => {
    const repo = makeRepo({
      findMembership: vi.fn(async () => ({ role: 'EDITOR' })),
      findDetail: vi.fn(async () => ({
        id: 'g1',
        workspaceId: null,
        scope: PageTemplateScope.GLOBAL,
        title: 'G',
        description: null,
        icon: null,
        type: PageType.TEXT,
        content: null,
        backingPageId: null,
        createdById: 'u1',
      })),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    const result = await svc.getById('u1', { templateId: 'g1', workspaceId: 'w1' })
    expect(result.canEdit).toBe(true)
  })

  it('returns canEdit: false for a GLOBAL template when actor !== createdById', async () => {
    const repo = makeRepo({
      findMembership: vi.fn(async () => ({ role: 'EDITOR' })),
      findDetail: vi.fn(async () => ({
        id: 'g1',
        workspaceId: null,
        scope: PageTemplateScope.GLOBAL,
        title: 'G',
        description: null,
        icon: null,
        type: PageType.TEXT,
        content: null,
        backingPageId: null,
        createdById: 'other-user',
      })),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    const result = await svc.getById('u1', { templateId: 'g1', workspaceId: 'w1' })
    expect(result.canEdit).toBe(false)
  })

  it('returns canEdit: true for a WORKSPACE template when member role is OWNER (not creator)', async () => {
    const repo = makeRepo({
      findMembership: vi.fn(async () => ({ role: 'OWNER' })),
      findDetail: vi.fn(async () => ({
        id: 't1',
        workspaceId: 'w1',
        scope: PageTemplateScope.WORKSPACE,
        title: 'T',
        description: null,
        icon: null,
        type: PageType.TEXT,
        content: null,
        backingPageId: 'bp1',
        createdById: 'other-user',
      })),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    const result = await svc.getById('u1', { templateId: 't1', workspaceId: 'w1' })
    expect(result.canEdit).toBe(true)
  })

  it('returns canEdit: false for a WORKSPACE template when actor is EDITOR and not creator', async () => {
    const repo = makeRepo({
      findMembership: vi.fn(async () => ({ role: 'EDITOR' })),
      findDetail: vi.fn(async () => ({
        id: 't1',
        workspaceId: 'w1',
        scope: PageTemplateScope.WORKSPACE,
        title: 'T',
        description: null,
        icon: null,
        type: PageType.TEXT,
        content: null,
        backingPageId: 'bp1',
        createdById: 'other-user',
      })),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    const result = await svc.getById('u1', { templateId: 't1', workspaceId: 'w1' })
    expect(result.canEdit).toBe(false)
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

  it('404s for a WORKSPACE template belonging to another workspace', async () => {
    const repo = makeRepo({
      findMembership: vi.fn(async () => ({ role: 'EDITOR' })),
      findDetail: vi.fn(async () => ({
        id: 't1',
        workspaceId: 'other-ws',
        scope: PageTemplateScope.WORKSPACE,
        title: 'T',
        description: null,
        icon: null,
        type: PageType.TEXT,
        content: null,
        backingPageId: null,
        createdById: 'u1',
      })),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    await expect(
      svc.getById('u1', { templateId: 't1', workspaceId: 'w1' }),
    ).rejects.toMatchObject({ httpStatus: 404 })
  })
})

describe('TemplateService.getBackingPage', () => {
  it('returns the backing page for an accessible template', async () => {
    const repo = makeRepo({
      findMembership: vi.fn(async () => ({ role: 'EDITOR' })),
      findDetail: vi.fn(async () => ({
        id: 't1',
        workspaceId: 'w1',
        scope: PageTemplateScope.WORKSPACE,
        title: 'T',
        description: null,
        icon: null,
        type: PageType.TEXT,
        content: null,
        backingPageId: 'bp1',
        createdById: 'u1',
      })),
      findBackingPageForTemplate: vi.fn(async () => ({
        id: 'bp1',
        type: PageType.TEXT,
        contentYjs: 'base64encodeddata==',
      })),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    const result = await svc.getBackingPage('u1', { templateId: 't1', workspaceId: 'w1' })
    expect(result.id).toBe('bp1')
    expect(result.type).toBe(PageType.TEXT)
    expect(result.contentYjs).toBe('base64encodeddata==')
  })

  it('throws NOT_FOUND when the template has no backingPageId', async () => {
    const repo = makeRepo({
      findMembership: vi.fn(async () => ({ role: 'EDITOR' })),
      findDetail: vi.fn(async () => ({
        id: 't1',
        workspaceId: 'w1',
        scope: PageTemplateScope.WORKSPACE,
        title: 'T',
        description: null,
        icon: null,
        type: PageType.TEXT,
        content: null,
        backingPageId: null,
        createdById: 'u1',
      })),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    await expect(
      svc.getBackingPage('u1', { templateId: 't1', workspaceId: 'w1' }),
    ).rejects.toMatchObject({ httpStatus: 404 })
  })

  it('throws NOT_FOUND when the actor is not a workspace member', async () => {
    const repo = makeRepo({
      findMembership: vi.fn(async () => null),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    await expect(
      svc.getBackingPage('u1', { templateId: 't1', workspaceId: 'w1' }),
    ).rejects.toMatchObject({ httpStatus: 403 })
  })
})

describe('TemplateService.updateContent', () => {
  it('updates content for the creator of a workspace template, forwarding derived bytes', async () => {
    const repo = makeRepo({
      // actor 'u1' is the creator
      findForWrite: vi.fn(async () => ({
        id: 't1',
        scope: PageTemplateScope.WORKSPACE,
        workspaceId: 'w1',
        createdById: 'u1',
      })),
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

  it('forbids editing a GLOBAL template when actor is not the creator', async () => {
    const repo = makeRepo({
      findForWrite: vi.fn(async () => ({
        id: 't1',
        scope: PageTemplateScope.GLOBAL,
        workspaceId: null,
        createdById: 'other-user',
      })),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    await expect(
      svc.updateContent('u1', { templateId: 't1', workspaceId: 'w1', content: {} }, null),
    ).rejects.toMatchObject({ httpStatus: 403 })
  })

  it('allows the creator of a GLOBAL template to update its content', async () => {
    const repo = makeRepo({
      findForWrite: vi.fn(async () => ({
        id: 't1',
        scope: PageTemplateScope.GLOBAL,
        workspaceId: null,
        createdById: 'u1',
      })),
      updateContent: vi.fn(async () => ({ id: 't1' })),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    const res = await svc.updateContent(
      'u1',
      { templateId: 't1', workspaceId: 'w1', content: { type: 'doc', content: [] } },
      null,
    )
    expect(res).toEqual({ id: 't1' })
  })
})

describe('TemplateService.listTags', () => {
  it('delegates to repo.listTags', async () => {
    const tags = [{ id: 'tag-1', slug: 'work', name: 'Work', icon: 'WorkOutlineIcon', position: 1 }]
    const repo = makeRepo({ listTags: vi.fn(async () => tags) })
    const svc = new TemplateService(repo, makeUow(), makePages())
    const res = await svc.listTags()
    expect(res).toEqual(tags)
    expect(repo.listTags).toHaveBeenCalledOnce()
  })
})

describe('TemplateService.listMarketplace', () => {
  const now = new Date('2026-01-01')
  const baseSummary = {
    description: null,
    icon: null,
    type: PageType.TEXT,
    averageRating: 0,
    ratingCount: 0,
    previewColor: null,
    tags: [],
    author: { name: 'AnyNote' },
    createdById: null,
    createdAt: now,
    updatedAt: now,
  }

  it('requires workspace membership', async () => {
    const repo = makeRepo({ findMembership: vi.fn(async () => null) })
    const svc = new TemplateService(repo, makeUow(), makePages())
    await expect(
      svc.listMarketplace('u1', { workspaceId: 'w1' }),
    ).rejects.toMatchObject({ httpStatus: 403 })
  })

  it('returns sectioned marketplace results with tags', async () => {
    const tags = [{ id: 'tag-1', slug: 'work', name: 'Work', icon: 'WorkOutlineIcon', position: 1 }]
    const candidates = [
      { ...baseSummary, id: 'ws-1', workspaceId: 'w1', scope: PageTemplateScope.WORKSPACE, title: 'WS Template', usageCount: 10 },
      { ...baseSummary, id: 'g-1', workspaceId: null, scope: PageTemplateScope.GLOBAL, title: 'Global Template', usageCount: 100 },
    ]
    const repo = makeRepo({
      listTags: vi.fn(async () => tags),
      marketplaceCandidates: vi.fn(async () => candidates),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    const res = await svc.listMarketplace('u1', { workspaceId: 'w1' })

    expect(res.tags).toEqual(tags)
    // workspaceTemplates filters to WORKSPACE scope
    expect(res.workspaceTemplates.map((t) => t.id)).toEqual(['ws-1'])
    // popularTemplates sorted by usageCount desc
    expect(res.popularTemplates.map((t) => t.id)).toEqual(['g-1', 'ws-1'])
    // allTemplates first limit items of candidates (usageCount desc from repo)
    expect(res.allTemplates.map((t) => t.id)).toEqual(['ws-1', 'g-1'])
  })

  it('respects sectionLimit', async () => {
    const candidates = Array.from({ length: 20 }, (_, i) => ({
      ...baseSummary,
      id: `t-${i}`,
      workspaceId: 'w1',
      scope: PageTemplateScope.WORKSPACE,
      title: `Template ${i}`,
      usageCount: i,
    }))
    const repo = makeRepo({ marketplaceCandidates: vi.fn(async () => candidates) })
    const svc = new TemplateService(repo, makeUow(), makePages())
    const res = await svc.listMarketplace('u1', { workspaceId: 'w1', sectionLimit: 3 })
    expect(res.workspaceTemplates).toHaveLength(3)
    expect(res.popularTemplates).toHaveLength(3)
    expect(res.allTemplates).toHaveLength(3)
  })
})
