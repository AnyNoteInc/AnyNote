import { describe, it, expect } from 'vitest'

import { PageType, PageTemplateScope } from '@repo/db'

import {
  buildCreatePageFromTemplatePayload,
  canCreateGlobalTemplate,
  canCreateWorkspaceTemplate,
  canEditGlobalTemplate,
  canEditWorkspaceTemplate,
  filterTemplatesByQuery,
  groupTemplatesByScope,
  sortTemplatesByRelevance,
} from '../../src/templates/templates.helpers.ts'
import type {
  TemplateContentDto,
  TemplateSummaryDto,
} from '../../src/templates/dto/templates.dto.ts'

function summary(over: Partial<TemplateSummaryDto>): TemplateSummaryDto {
  return {
    id: 'id',
    workspaceId: null,
    scope: PageTemplateScope.GLOBAL,
    title: 'Title',
    description: null,
    icon: null,
    category: null,
    type: PageType.TEXT,
    usageCount: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  }
}

describe('canCreateWorkspaceTemplate', () => {
  it('allows the page creator regardless of role', () => {
    expect(canCreateWorkspaceTemplate({ isPageCreator: true, role: null })).toBe(true)
    expect(canCreateWorkspaceTemplate({ isPageCreator: true, role: 'VIEWER' })).toBe(true)
  })

  it('allows writable roles', () => {
    for (const role of ['OWNER', 'ADMIN', 'EDITOR']) {
      expect(canCreateWorkspaceTemplate({ isPageCreator: false, role })).toBe(true)
    }
  })

  it('rejects read-only roles and missing membership', () => {
    for (const role of ['COMMENTER', 'VIEWER', 'GUEST']) {
      expect(canCreateWorkspaceTemplate({ isPageCreator: false, role })).toBe(false)
    }
    expect(canCreateWorkspaceTemplate({ isPageCreator: false, role: null })).toBe(false)
    expect(canCreateWorkspaceTemplate({ isPageCreator: false, role: undefined })).toBe(false)
  })
})

describe('canCreateGlobalTemplate', () => {
  it('always returns true — any authenticated member may publish a global template', () => {
    expect(canCreateGlobalTemplate({ role: 'OWNER' })).toBe(true)
    expect(canCreateGlobalTemplate({ role: 'ADMIN' })).toBe(true)
    expect(canCreateGlobalTemplate({})).toBe(true)
  })
})

describe('template permissions', () => {
  it('lets any authenticated member create global templates', () => {
    expect(canCreateGlobalTemplate({ role: 'VIEWER' })).toBe(true)
    expect(canCreateGlobalTemplate({ role: null })).toBe(true)
  })

  it('global edit: creator only', () => {
    expect(canEditGlobalTemplate({ actorUserId: 'u1', createdById: 'u1' })).toBe(true)
    expect(canEditGlobalTemplate({ actorUserId: 'u2', createdById: 'u1' })).toBe(false)
    expect(canEditGlobalTemplate({ actorUserId: 'u1', createdById: null })).toBe(false)
  })

  it('workspace edit: owner, admin, or creator', () => {
    const base = { actorUserId: 'u2', createdById: 'u1' }
    expect(canEditWorkspaceTemplate({ ...base, role: 'OWNER' })).toBe(true)
    expect(canEditWorkspaceTemplate({ ...base, role: 'ADMIN' })).toBe(true)
    expect(canEditWorkspaceTemplate({ ...base, role: 'EDITOR' })).toBe(false)
    expect(canEditWorkspaceTemplate({ actorUserId: 'u1', createdById: 'u1', role: 'EDITOR' })).toBe(
      true,
    )
    expect(canEditWorkspaceTemplate({ ...base, role: null })).toBe(false)
  })
})

describe('filterTemplatesByQuery', () => {
  const items = [
    summary({ id: 'a', title: 'Project Plan', description: 'Outline goals' }),
    summary({ id: 'b', title: 'Meeting Notes', description: 'Capture decisions' }),
    summary({ id: 'c', title: 'Retrospective', description: null }),
  ]

  it('returns a copy of all when query is empty', () => {
    const out = filterTemplatesByQuery(items, '')
    expect(out).toHaveLength(3)
    expect(out).not.toBe(items)
  })

  it('matches by title (case-insensitive)', () => {
    expect(filterTemplatesByQuery(items, 'project').map((t) => t.id)).toEqual(['a'])
    expect(filterTemplatesByQuery(items, 'PROJECT').map((t) => t.id)).toEqual(['a'])
  })

  it('matches by description', () => {
    expect(filterTemplatesByQuery(items, 'decisions').map((t) => t.id)).toEqual(['b'])
  })

  it('returns empty when nothing matches', () => {
    expect(filterTemplatesByQuery(items, 'zzz')).toEqual([])
  })

  it('trims whitespace-only queries to the empty-query behavior', () => {
    expect(filterTemplatesByQuery(items, '   ')).toHaveLength(3)
  })
})

describe('sortTemplatesByRelevance', () => {
  it('orders title-starts-with before title-contains before description-contains', () => {
    const items = [
      summary({ id: 'descMatch', title: 'Unrelated', description: 'a plan for things' }),
      summary({ id: 'contains', title: 'Big Plan Doc' }),
      summary({ id: 'starts', title: 'Plan of record' }),
    ]
    expect(sortTemplatesByRelevance(items, 'plan').map((t) => t.id)).toEqual([
      'starts',
      'contains',
      'descMatch',
    ])
  })

  it('breaks ties by usageCount desc then createdAt desc', () => {
    const items = [
      summary({ id: 'old', title: 'Plan A', usageCount: 5, createdAt: new Date('2026-01-01') }),
      summary({ id: 'new', title: 'Plan B', usageCount: 5, createdAt: new Date('2026-02-01') }),
      summary({ id: 'popular', title: 'Plan C', usageCount: 9, createdAt: new Date('2025-01-01') }),
    ]
    expect(sortTemplatesByRelevance(items, 'plan').map((t) => t.id)).toEqual([
      'popular',
      'new',
      'old',
    ])
  })

  it('does not mutate the input array', () => {
    const items = [summary({ id: 'a', title: 'b' }), summary({ id: 'b', title: 'a' })]
    const before = items.map((t) => t.id)
    sortTemplatesByRelevance(items, '')
    expect(items.map((t) => t.id)).toEqual(before)
  })
})

describe('groupTemplatesByScope', () => {
  it('splits workspace and global templates', () => {
    const items = [
      summary({ id: 'w1', scope: PageTemplateScope.WORKSPACE }),
      summary({ id: 'g1', scope: PageTemplateScope.GLOBAL }),
      summary({ id: 'w2', scope: PageTemplateScope.WORKSPACE }),
    ]
    const { workspaceTemplates, globalTemplates } = groupTemplatesByScope(items)
    expect(workspaceTemplates.map((t) => t.id)).toEqual(['w1', 'w2'])
    expect(globalTemplates.map((t) => t.id)).toEqual(['g1'])
  })
})

describe('buildCreatePageFromTemplatePayload', () => {
  const template: TemplateContentDto = {
    id: 't1',
    workspaceId: null,
    scope: PageTemplateScope.GLOBAL,
    title: 'Weekly Review',
    icon: '📋',
    type: PageType.TEXT,
    content: { type: 'doc', content: [] },
    contentYjs: new Uint8Array(new ArrayBuffer(4)),
  }

  it('falls back to the template title when none is provided', () => {
    const payload = buildCreatePageFromTemplatePayload(template, {
      workspaceId: 'w1',
      parentId: null,
      title: undefined,
    })
    expect(payload.title).toBe('Weekly Review')
    expect(payload.type).toBe(PageType.TEXT)
    expect(payload.icon).toBe('📋')
    expect(payload.content).toEqual({ type: 'doc', content: [] })
    expect(payload.contentYjs).toBe(template.contentYjs)
    expect(payload.workspaceId).toBe('w1')
    expect(payload.parentId).toBeNull()
  })

  it('uses the provided title when non-empty', () => {
    const payload = buildCreatePageFromTemplatePayload(template, {
      workspaceId: 'w1',
      parentId: 'p1',
      title: '  My page  ',
    })
    expect(payload.title).toBe('My page')
    expect(payload.parentId).toBe('p1')
  })

  it('falls back to template title when provided title is blank', () => {
    const payload = buildCreatePageFromTemplatePayload(template, {
      workspaceId: 'w1',
      parentId: null,
      title: '   ',
    })
    expect(payload.title).toBe('Weekly Review')
  })

  it('maps null content/icon to undefined for create input', () => {
    const payload = buildCreatePageFromTemplatePayload(
      { ...template, content: null, contentYjs: null, icon: null },
      { workspaceId: 'w1', parentId: null, title: undefined },
    )
    expect(payload.content).toBeUndefined()
    expect(payload.contentYjs).toBeUndefined()
    expect(payload.icon).toBeUndefined()
  })
})
