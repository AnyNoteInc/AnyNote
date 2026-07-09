import { describe, it, expect, vi, beforeEach } from 'vitest'

import { PageTemplateScope, PageType } from '@repo/db'

import { isDomainError } from '../../src/shared/errors.ts'
import type { UnitOfWork } from '../../src/shared/unit-of-work.ts'
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

const SOURCE_PAGE = {
  id: 'p1',
  workspaceId: 'w1',
  createdById: 'u1',
  title: 'Source',
  icon: '📄',
  type: PageType.TEXT,
  content: { type: 'doc', content: [] },
  contentYjs: new Uint8Array(new ArrayBuffer(4)),
}

const WS_DETAIL = {
  id: 't1',
  workspaceId: 'w1',
  scope: PageTemplateScope.WORKSPACE,
  title: 'Tmpl',
  icon: '📋',
  type: PageType.TEXT,
  contentYjs: new Uint8Array(new ArrayBuffer(4)),
  description: null,
  createdById: 'u1',
}

const COPY_CONTENT = {
  content: { type: 'doc', content: [] },
  contentYjs: new Uint8Array(new ArrayBuffer(4)),
  icon: '📋',
  type: PageType.TEXT,
}

function makeRepo(
  overrides: Partial<Record<keyof TemplateRepository, ReturnType<typeof vi.fn>>> = {},
): TemplateRepository {
  return {
    findMembership: vi.fn(async () => ({ role: 'EDITOR' })),
    findSystemWorkspaceId: vi.fn(async () => 'sys-ws'),
    findAccessiblePage: vi.fn(async () => ({ ...SOURCE_PAGE })),
    marketplaceCandidates: vi.fn(async () => []),
    listTags: vi.fn(async () => []),
    countExistingTags: vi.fn(async () => 0),
    findTemplateDetail: vi.fn(async () => ({ ...WS_DETAIL })),
    findTemplateContentForCopy: vi.fn(async () => ({ ...COPY_CONTENT })),
    findTemplateContent: vi.fn(async () => ({ type: 'doc', content: [] })),
    createTemplatePage: vi.fn(async () => ({ id: 't-new' })),
    createPageFromTemplatePage: vi.fn(async () => ({ id: 'page-new' })),
    incrementUsage: vi.fn(async () => undefined),
    linkTags: vi.fn(async () => undefined),
    updateTemplatePage: vi.fn(async () => ({ id: 't1' })),
    softDeleteTemplatePage: vi.fn(async () => ({ id: 't1' })),
    setFilesPublic: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as TemplateRepository
}

function makeSvc(repo: TemplateRepository): TemplateService {
  return new TemplateService(repo, makeUow())
}

// ── createFromPage ───────────────────────────────────────────────────────────

describe('TemplateService.createFromPage', () => {
  let repo: TemplateRepository
  let svc: TemplateService

  beforeEach(() => {
    repo = makeRepo()
    svc = makeSvc(repo)
  })

  it('copies the source page into a WORKSPACE template page in the same workspace', async () => {
    const res = await svc.createFromPage('u1', {
      pageId: 'p1',
      workspaceId: 'w1',
      title: 'My template',
      scope: PageTemplateScope.WORKSPACE,
    })
    expect(res).toEqual({ id: 't-new' })
    expect(repo.createTemplatePage).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        workspaceId: 'w1',
        scope: PageTemplateScope.WORKSPACE,
        title: 'My template',
        content: SOURCE_PAGE.content,
        contentYjs: SOURCE_PAGE.contentYjs,
        type: PageType.TEXT,
      }),
    )
    expect(repo.linkTags).toHaveBeenCalledWith('t-new', [])
    // WORKSPACE → no system workspace lookup, no file publishing
    expect(repo.findSystemWorkspaceId).not.toHaveBeenCalled()
    expect(repo.setFilesPublic).not.toHaveBeenCalled()
  })

  it('creates a GLOBAL template in the system workspace and publishes its files', async () => {
    repo = makeRepo({
      findAccessiblePage: vi.fn(async () => ({
        ...SOURCE_PAGE,
        content: {
          type: 'doc',
          content: [
            {
              type: 'image',
              attrs: { src: '/api/files/11111111-1111-4111-9111-111111111111' },
            },
          ],
        },
      })),
    })
    svc = makeSvc(repo)
    const res = await svc.createFromPage('u1', {
      pageId: 'p1',
      workspaceId: 'w1',
      title: 'Global',
      scope: PageTemplateScope.GLOBAL,
    })
    expect(res).toEqual({ id: 't-new' })
    expect(repo.findSystemWorkspaceId).toHaveBeenCalledOnce()
    expect(repo.createTemplatePage).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ workspaceId: 'sys-ws', scope: PageTemplateScope.GLOBAL }),
    )
    expect(repo.setFilesPublic).toHaveBeenCalledWith([
      '11111111-1111-4111-9111-111111111111',
    ])
  })

  it('throws when the system workspace is missing for a GLOBAL template', async () => {
    repo = makeRepo({ findSystemWorkspaceId: vi.fn(async () => null) })
    svc = makeSvc(repo)
    await expect(
      svc.createFromPage('u1', {
        pageId: 'p1',
        workspaceId: 'w1',
        title: 'Global',
        scope: PageTemplateScope.GLOBAL,
      }),
    ).rejects.toMatchObject({ httpStatus: 400 })
    expect(repo.createTemplatePage).not.toHaveBeenCalled()
  })

  it('throws NOT_FOUND when the source page is inaccessible', async () => {
    repo = makeRepo({ findAccessiblePage: vi.fn(async () => null) })
    svc = makeSvc(repo)
    await expect(
      svc.createFromPage('u1', {
        pageId: 'p1',
        workspaceId: 'w1',
        title: 'X',
        scope: PageTemplateScope.WORKSPACE,
      }),
    ).rejects.toMatchObject({ httpStatus: 404 })
  })

  it('rejects when the page belongs to a different workspace', async () => {
    repo = makeRepo({
      findAccessiblePage: vi.fn(async () => ({ ...SOURCE_PAGE, workspaceId: 'other-ws' })),
    })
    svc = makeSvc(repo)
    await expect(
      svc.createFromPage('u1', {
        pageId: 'p1',
        workspaceId: 'w1',
        title: 'X',
        scope: PageTemplateScope.WORKSPACE,
      }),
    ).rejects.toMatchObject({ httpStatus: 400 })
  })

  it('forbids a non-creator read-only member from creating a WORKSPACE template', async () => {
    repo = makeRepo({
      findAccessiblePage: vi.fn(async () => ({ ...SOURCE_PAGE, createdById: 'someone-else' })),
      findMembership: vi.fn(async () => ({ role: 'VIEWER' })),
    })
    svc = makeSvc(repo)
    await expect(
      svc.createFromPage('u1', {
        pageId: 'p1',
        workspaceId: 'w1',
        title: 'X',
        scope: PageTemplateScope.WORKSPACE,
      }),
    ).rejects.toMatchObject({ httpStatus: 403 })
  })

  it('allows any accessible-page member to create a GLOBAL template (no role gate)', async () => {
    repo = makeRepo({ findMembership: vi.fn(async () => null) })
    svc = makeSvc(repo)
    const res = await svc.createFromPage('u1', {
      pageId: 'p1',
      workspaceId: 'w1',
      title: 'X',
      scope: PageTemplateScope.GLOBAL,
    })
    expect(res).toEqual({ id: 't-new' })
  })

  it('rejects an unknown tag id', async () => {
    repo = makeRepo({ countExistingTags: vi.fn(async () => 0) })
    svc = makeSvc(repo)
    await expect(
      svc.createFromPage('u1', {
        pageId: 'p1',
        workspaceId: 'w1',
        title: 'X',
        scope: PageTemplateScope.WORKSPACE,
        tagIds: ['00000000-0000-4000-8000-000000000099'],
      }),
    ).rejects.toMatchObject({ httpStatus: 400 })
    expect(repo.createTemplatePage).not.toHaveBeenCalled()
  })
})

// ── createPageFromTemplate ───────────────────────────────────────────────────

describe('TemplateService.createPageFromTemplate', () => {
  it('deep-copies the template into a new page and increments usage', async () => {
    const repo = makeRepo()
    const svc = makeSvc(repo)
    const res = await svc.createPageFromTemplate('u1', {
      templateId: 't1',
      workspaceId: 'w1',
      parentId: 'parent-1',
    })
    expect(res).toEqual({ id: 'page-new' })
    expect(repo.createPageFromTemplatePage).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        templatePageId: 't1',
        workspaceId: 'w1',
        parentId: 'parent-1',
        title: 'Tmpl',
        content: COPY_CONTENT.content,
        contentYjs: COPY_CONTENT.contentYjs,
        icon: '📋',
        type: PageType.TEXT,
      }),
    )
    expect(repo.incrementUsage).toHaveBeenCalledWith('t1')
  })

  it('uses the provided title when non-empty', async () => {
    const repo = makeRepo()
    const svc = makeSvc(repo)
    await svc.createPageFromTemplate('u1', {
      templateId: 't1',
      workspaceId: 'w1',
      parentId: null,
      title: '  Custom  ',
    })
    expect(repo.createPageFromTemplatePage).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ title: 'Custom' }),
    )
  })

  it('rejects a WORKSPACE template from a different workspace (membership check)', async () => {
    const repo = makeRepo({
      findTemplateDetail: vi.fn(async () => ({ ...WS_DETAIL, workspaceId: 'other-ws' })),
      // actor is not a member of other-ws
      findMembership: vi.fn(async () => null),
    })
    const svc = makeSvc(repo)
    await expect(
      svc.createPageFromTemplate('u1', { templateId: 't1', workspaceId: 'w1', parentId: null }),
    ).rejects.toMatchObject({ httpStatus: 403 })
  })

  it('allows a GLOBAL template for any workspace member', async () => {
    const repo = makeRepo({
      findTemplateDetail: vi.fn(async () => ({
        ...WS_DETAIL,
        id: 'g1',
        scope: PageTemplateScope.GLOBAL,
        createdById: 'other-user',
      })),
    })
    const svc = makeSvc(repo)
    await svc.createPageFromTemplate('u1', { templateId: 'g1', workspaceId: 'w1', parentId: null })
    expect(repo.createPageFromTemplatePage).toHaveBeenCalledOnce()
    expect(repo.incrementUsage).toHaveBeenCalledWith('g1')
  })

  it('throws when the target workspace membership is missing', async () => {
    const repo = makeRepo({ findMembership: vi.fn(async () => null) })
    const svc = makeSvc(repo)
    await expect(
      svc.createPageFromTemplate('u1', { templateId: 't1', workspaceId: 'w1', parentId: null }),
    ).rejects.toSatisfy(isDomainError)
  })

  it('404s when the template is missing', async () => {
    const repo = makeRepo({ findTemplateDetail: vi.fn(async () => null) })
    const svc = makeSvc(repo)
    await expect(
      svc.createPageFromTemplate('u1', { templateId: 't1', workspaceId: 'w1', parentId: null }),
    ).rejects.toMatchObject({ httpStatus: 404 })
  })
})

// ── getTemplate ──────────────────────────────────────────────────────────────

describe('TemplateService.getTemplate', () => {
  it('returns a WORKSPACE template detail (canEdit true for creator)', async () => {
    const repo = makeRepo({
      findMembership: vi.fn(async () => ({ role: 'EDITOR' })),
      findTemplateDetail: vi.fn(async () => ({ ...WS_DETAIL, createdById: 'u1' })),
    })
    const svc = makeSvc(repo)
    const result = await svc.getTemplate('u1', { templateId: 't1', workspaceId: 'w1' })
    expect(result.id).toBe('t1')
    expect(result.canEdit).toBe(true)
    // contentYjs is base64-encoded
    expect(result.contentYjs).toBe(Buffer.from(WS_DETAIL.contentYjs).toString('base64'))
  })

  it('GLOBAL non-creator: viewable but canEdit false (no membership required)', async () => {
    const findMembership = vi.fn(async () => null)
    const repo = makeRepo({
      findMembership,
      findTemplateDetail: vi.fn(async () => ({
        ...WS_DETAIL,
        id: 'g1',
        scope: PageTemplateScope.GLOBAL,
        createdById: 'other-user',
      })),
    })
    const svc = makeSvc(repo)
    const result = await svc.getTemplate('u1', { templateId: 'g1', workspaceId: 'w1' })
    expect(result.canEdit).toBe(false)
    // GLOBAL access must NOT require membership
    expect(findMembership).not.toHaveBeenCalled()
  })

  it('GLOBAL creator: canEdit true', async () => {
    const repo = makeRepo({
      findTemplateDetail: vi.fn(async () => ({
        ...WS_DETAIL,
        id: 'g1',
        scope: PageTemplateScope.GLOBAL,
        createdById: 'u1',
      })),
    })
    const svc = makeSvc(repo)
    const result = await svc.getTemplate('u1', { templateId: 'g1', workspaceId: 'w1' })
    expect(result.canEdit).toBe(true)
  })

  it('WORKSPACE template: throws FORBIDDEN for a non-member', async () => {
    const repo = makeRepo({ findMembership: vi.fn(async () => null) })
    const svc = makeSvc(repo)
    await expect(
      svc.getTemplate('u1', { templateId: 't1', workspaceId: 'w1' }),
    ).rejects.toMatchObject({ httpStatus: 403 })
  })

  it('WORKSPACE OWNER (not creator): canEdit true', async () => {
    const repo = makeRepo({
      findMembership: vi.fn(async () => ({ role: 'OWNER' })),
      findTemplateDetail: vi.fn(async () => ({ ...WS_DETAIL, createdById: 'other-user' })),
    })
    const svc = makeSvc(repo)
    const result = await svc.getTemplate('u1', { templateId: 't1', workspaceId: 'w1' })
    expect(result.canEdit).toBe(true)
  })

  it('WORKSPACE EDITOR (not creator): canEdit false', async () => {
    const repo = makeRepo({
      findMembership: vi.fn(async () => ({ role: 'EDITOR' })),
      findTemplateDetail: vi.fn(async () => ({ ...WS_DETAIL, createdById: 'other-user' })),
    })
    const svc = makeSvc(repo)
    const result = await svc.getTemplate('u1', { templateId: 't1', workspaceId: 'w1' })
    expect(result.canEdit).toBe(false)
  })

  it('404s when the template is missing', async () => {
    const repo = makeRepo({ findTemplateDetail: vi.fn(async () => null) })
    const svc = makeSvc(repo)
    await expect(
      svc.getTemplate('u1', { templateId: 't1', workspaceId: 'w1' }),
    ).rejects.toMatchObject({ httpStatus: 404 })
  })
})

// ── update ───────────────────────────────────────────────────────────────────

describe('TemplateService.update', () => {
  it('updates a WORKSPACE template for the creator and relinks tags', async () => {
    const repo = makeRepo({
      findTemplateDetail: vi.fn(async () => ({ ...WS_DETAIL, createdById: 'u1' })),
      countExistingTags: vi.fn(async () => 1),
    })
    const svc = makeSvc(repo)
    const res = await svc.update('u1', {
      templateId: 't1',
      workspaceId: 'w1',
      title: 'Renamed',
      tagIds: ['00000000-0000-4000-8000-000000000001'],
    })
    expect(res).toEqual({ id: 't1' })
    expect(repo.updateTemplatePage).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ pageId: 't1', title: 'Renamed' }),
    )
    expect(repo.linkTags).toHaveBeenCalledWith('t1', [
      '00000000-0000-4000-8000-000000000001',
    ])
  })

  it('does not relink tags when tagIds is omitted', async () => {
    const repo = makeRepo({
      findTemplateDetail: vi.fn(async () => ({ ...WS_DETAIL, createdById: 'u1' })),
    })
    const svc = makeSvc(repo)
    await svc.update('u1', { templateId: 't1', workspaceId: 'w1', title: 'Renamed' })
    expect(repo.linkTags).not.toHaveBeenCalled()
  })

  it('re-publishes files public for a GLOBAL template on update', async () => {
    const repo = makeRepo({
      findTemplateDetail: vi.fn(async () => ({
        ...WS_DETAIL,
        scope: PageTemplateScope.GLOBAL,
        createdById: 'u1',
      })),
      findTemplateContent: vi.fn(async () => ({
        type: 'doc',
        content: [
          { type: 'image', attrs: { src: '/api/files/22222222-2222-4222-9222-222222222222' } },
        ],
      })),
    })
    const svc = makeSvc(repo)
    await svc.update('u1', { templateId: 't1', workspaceId: 'w1', title: 'Renamed' })
    expect(repo.setFilesPublic).toHaveBeenCalledWith([
      '22222222-2222-4222-9222-222222222222',
    ])
  })

  it('forbids a GLOBAL template update by a non-creator', async () => {
    const repo = makeRepo({
      findTemplateDetail: vi.fn(async () => ({
        ...WS_DETAIL,
        scope: PageTemplateScope.GLOBAL,
        createdById: 'other-user',
      })),
    })
    const svc = makeSvc(repo)
    await expect(
      svc.update('u1', { templateId: 't1', workspaceId: 'w1', title: 'X' }),
    ).rejects.toMatchObject({ httpStatus: 403 })
    expect(repo.updateTemplatePage).not.toHaveBeenCalled()
  })

  it('forbids a WORKSPACE template update by a non-creator EDITOR', async () => {
    const repo = makeRepo({
      findMembership: vi.fn(async () => ({ role: 'EDITOR' })),
      findTemplateDetail: vi.fn(async () => ({ ...WS_DETAIL, createdById: 'other-user' })),
    })
    const svc = makeSvc(repo)
    await expect(
      svc.update('u1', { templateId: 't1', workspaceId: 'w1', title: 'X' }),
    ).rejects.toMatchObject({ httpStatus: 403 })
  })

  it('rejects an unknown tag id', async () => {
    const repo = makeRepo({
      findTemplateDetail: vi.fn(async () => ({ ...WS_DETAIL, createdById: 'u1' })),
      countExistingTags: vi.fn(async () => 0),
    })
    const svc = makeSvc(repo)
    await expect(
      svc.update('u1', {
        templateId: 't1',
        workspaceId: 'w1',
        tagIds: ['00000000-0000-4000-8000-000000000099'],
      }),
    ).rejects.toMatchObject({ httpStatus: 400 })
    expect(repo.updateTemplatePage).not.toHaveBeenCalled()
  })

  it('404s when the template is missing', async () => {
    const repo = makeRepo({ findTemplateDetail: vi.fn(async () => null) })
    const svc = makeSvc(repo)
    await expect(
      svc.update('u1', { templateId: 't1', workspaceId: 'w1', title: 'X' }),
    ).rejects.toMatchObject({ httpStatus: 404 })
  })
})

// ── delete ───────────────────────────────────────────────────────────────────

describe('TemplateService.delete', () => {
  it('soft-deletes a WORKSPACE template for the creator', async () => {
    const repo = makeRepo({
      findTemplateDetail: vi.fn(async () => ({ ...WS_DETAIL, createdById: 'u1' })),
    })
    const svc = makeSvc(repo)
    const res = await svc.delete('u1', { templateId: 't1', workspaceId: 'w1' })
    expect(res).toEqual({ count: 1 })
    expect(repo.softDeleteTemplatePage).toHaveBeenCalledWith('t1')
  })

  it('allows OWNER to delete a WORKSPACE template they did not create', async () => {
    const repo = makeRepo({
      findMembership: vi.fn(async () => ({ role: 'OWNER' })),
      findTemplateDetail: vi.fn(async () => ({ ...WS_DETAIL, createdById: 'other-user' })),
    })
    const svc = makeSvc(repo)
    const res = await svc.delete('u1', { templateId: 't1', workspaceId: 'w1' })
    expect(res).toEqual({ count: 1 })
  })

  it('refuses to delete a GLOBAL template when actor is not its creator', async () => {
    const repo = makeRepo({
      findTemplateDetail: vi.fn(async () => ({
        ...WS_DETAIL,
        scope: PageTemplateScope.GLOBAL,
        createdById: 'other-user',
      })),
    })
    const svc = makeSvc(repo)
    await expect(
      svc.delete('u1', { templateId: 't1', workspaceId: 'w1' }),
    ).rejects.toMatchObject({ httpStatus: 403 })
    expect(repo.softDeleteTemplatePage).not.toHaveBeenCalled()
  })

  it('allows the creator of a GLOBAL template to delete it', async () => {
    const repo = makeRepo({
      findTemplateDetail: vi.fn(async () => ({
        ...WS_DETAIL,
        scope: PageTemplateScope.GLOBAL,
        createdById: 'u1',
      })),
    })
    const svc = makeSvc(repo)
    const res = await svc.delete('u1', { templateId: 't1', workspaceId: 'w1' })
    expect(res).toEqual({ count: 1 })
  })

  it('forbids deleting a WORKSPACE template by a non-creator EDITOR', async () => {
    const repo = makeRepo({
      findMembership: vi.fn(async () => ({ role: 'EDITOR' })),
      findTemplateDetail: vi.fn(async () => ({ ...WS_DETAIL, createdById: 'other-user' })),
    })
    const svc = makeSvc(repo)
    await expect(
      svc.delete('u1', { templateId: 't1', workspaceId: 'w1' }),
    ).rejects.toMatchObject({ httpStatus: 403 })
  })

  it('404s when the template is missing', async () => {
    const repo = makeRepo({ findTemplateDetail: vi.fn(async () => null) })
    const svc = makeSvc(repo)
    await expect(
      svc.delete('u1', { templateId: 't1', workspaceId: 'w1' }),
    ).rejects.toMatchObject({ httpStatus: 404 })
  })
})

// ── listTags / listMarketplace ───────────────────────────────────────────────

describe('TemplateService.listTags', () => {
  it('delegates to repo.listTags', async () => {
    const tags = [{ id: 'tag-1', slug: 'work', name: 'Work', icon: 'WorkOutlineIcon', position: 1 }]
    const repo = makeRepo({ listTags: vi.fn(async () => tags) })
    const svc = makeSvc(repo)
    const res = await svc.listTags()
    expect(res).toEqual(tags)
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
    previewContent: null,
    tags: [],
    author: { name: 'AnyNote' },
    createdById: null,
    createdAt: now,
    updatedAt: now,
  }

  it('requires workspace membership', async () => {
    const repo = makeRepo({ findMembership: vi.fn(async () => null) })
    const svc = makeSvc(repo)
    await expect(svc.listMarketplace('u1', { workspaceId: 'w1' })).rejects.toMatchObject({
      httpStatus: 403,
    })
  })

  it('returns sectioned marketplace results with tags', async () => {
    const tags = [{ id: 'tag-1', slug: 'work', name: 'Work', icon: 'WorkOutlineIcon', position: 1 }]
    const candidates = [
      { ...baseSummary, id: 'ws-1', workspaceId: 'w1', scope: PageTemplateScope.WORKSPACE, title: 'WS', usageCount: 10 },
      { ...baseSummary, id: 'g-1', workspaceId: 'sys', scope: PageTemplateScope.GLOBAL, title: 'Global', usageCount: 100 },
    ]
    const repo = makeRepo({
      listTags: vi.fn(async () => tags),
      marketplaceCandidates: vi.fn(async () => candidates),
    })
    const svc = makeSvc(repo)
    const res = await svc.listMarketplace('u1', { workspaceId: 'w1' })
    expect(res.tags).toEqual(tags)
    expect(res.workspaceTemplates.map((t) => t.id)).toEqual(['ws-1'])
    expect(res.popularTemplates.map((t) => t.id)).toEqual(['g-1', 'ws-1'])
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
    const svc = makeSvc(repo)
    const res = await svc.listMarketplace('u1', { workspaceId: 'w1', sectionLimit: 3 })
    expect(res.workspaceTemplates).toHaveLength(3)
    expect(res.popularTemplates).toHaveLength(3)
    expect(res.allTemplates).toHaveLength(3)
  })
})
