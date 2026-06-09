import { describe, it, expect } from 'vitest'

import { DatabaseAccessLevel, RoleType, DatabasePropertyType } from '@repo/db'

import {
  LEVEL_ORDER,
  maxLevel,
  canViewRow,
  canEditRow,
  resolveRowAccess,
} from '../../../src/database/services/row-access-resolver.ts'
import type {
  RowAccessContext,
  AccessRule,
  RowAccessRow,
} from '../../../src/database/services/row-access-resolver.ts'

const VIEWER = 'user-viewer'
const OTHER = 'user-other'

// A context for a plain workspace member (no broad access, no share).
function memberCtx(role: RoleType | null, overrides: Partial<RowAccessContext> = {}): RowAccessContext {
  return {
    viewerId: VIEWER,
    workspaceRole: role,
    isSourcePageCreator: false,
    pageShareLevel: null,
    ...overrides,
  }
}

function personRule(propertyId: string, level: DatabaseAccessLevel, enabled = true): AccessRule {
  return { propertyId, propertyType: DatabasePropertyType.PERSON, accessLevel: level, enabled }
}

function createdByRule(propertyId: string, level: DatabaseAccessLevel, enabled = true): AccessRule {
  return { propertyId, propertyType: DatabasePropertyType.CREATED_BY, accessLevel: level, enabled }
}

function row(rowCreatedById: string | null, cells: Record<string, unknown> = {}): RowAccessRow {
  return { rowCreatedById, cellsByProperty: new Map(Object.entries(cells)) }
}

describe('LEVEL_ORDER', () => {
  it('orders CAN_VIEW < CAN_COMMENT < CAN_EDIT_CONTENT < CAN_EDIT < FULL_ACCESS', () => {
    expect(LEVEL_ORDER[DatabaseAccessLevel.CAN_VIEW]).toBe(1)
    expect(LEVEL_ORDER[DatabaseAccessLevel.CAN_COMMENT]).toBe(2)
    expect(LEVEL_ORDER[DatabaseAccessLevel.CAN_EDIT_CONTENT]).toBe(3)
    expect(LEVEL_ORDER[DatabaseAccessLevel.CAN_EDIT]).toBe(4)
    expect(LEVEL_ORDER[DatabaseAccessLevel.FULL_ACCESS]).toBe(5)
  })
})

describe('maxLevel', () => {
  it('returns the higher-ordered of two levels', () => {
    expect(maxLevel(DatabaseAccessLevel.CAN_VIEW, DatabaseAccessLevel.CAN_EDIT_CONTENT)).toBe(
      DatabaseAccessLevel.CAN_EDIT_CONTENT,
    )
    expect(maxLevel(DatabaseAccessLevel.FULL_ACCESS, DatabaseAccessLevel.CAN_EDIT)).toBe(
      DatabaseAccessLevel.FULL_ACCESS,
    )
  })

  it('treats null as the lowest possible level', () => {
    expect(maxLevel(null, DatabaseAccessLevel.CAN_VIEW)).toBe(DatabaseAccessLevel.CAN_VIEW)
    expect(maxLevel(DatabaseAccessLevel.CAN_COMMENT, null)).toBe(DatabaseAccessLevel.CAN_COMMENT)
    expect(maxLevel(null, null)).toBeNull()
  })
})

describe('canViewRow / canEditRow', () => {
  it('canViewRow is true for any non-null level (>= CAN_VIEW)', () => {
    expect(canViewRow(DatabaseAccessLevel.CAN_VIEW)).toBe(true)
    expect(canViewRow(DatabaseAccessLevel.FULL_ACCESS)).toBe(true)
    expect(canViewRow(null)).toBe(false)
  })

  it('canEditRow requires >= CAN_EDIT_CONTENT', () => {
    expect(canEditRow(null)).toBe(false)
    expect(canEditRow(DatabaseAccessLevel.CAN_VIEW)).toBe(false)
    expect(canEditRow(DatabaseAccessLevel.CAN_COMMENT)).toBe(false)
    expect(canEditRow(DatabaseAccessLevel.CAN_EDIT_CONTENT)).toBe(true)
    expect(canEditRow(DatabaseAccessLevel.CAN_EDIT)).toBe(true)
    expect(canEditRow(DatabaseAccessLevel.FULL_ACCESS)).toBe(true)
  })
})

describe('resolveRowAccess — no rules (preserves today behavior)', () => {
  it('workspace EDITOR → CAN_EDIT_CONTENT', () => {
    expect(resolveRowAccess(memberCtx(RoleType.EDITOR), [], row(OTHER))).toBe(
      DatabaseAccessLevel.CAN_EDIT_CONTENT,
    )
  })

  it('workspace COMMENTER → CAN_COMMENT', () => {
    expect(resolveRowAccess(memberCtx(RoleType.COMMENTER), [], row(OTHER))).toBe(
      DatabaseAccessLevel.CAN_COMMENT,
    )
  })

  it('workspace VIEWER → CAN_VIEW', () => {
    expect(resolveRowAccess(memberCtx(RoleType.VIEWER), [], row(OTHER))).toBe(
      DatabaseAccessLevel.CAN_VIEW,
    )
  })

  it('workspace GUEST → CAN_VIEW', () => {
    expect(resolveRowAccess(memberCtx(RoleType.GUEST), [], row(OTHER))).toBe(
      DatabaseAccessLevel.CAN_VIEW,
    )
  })

  it('non-member (role null, not creator) → null', () => {
    expect(resolveRowAccess(memberCtx(null), [], row(OTHER))).toBeNull()
  })
})

describe('resolveRowAccess — broad direct access (regardless of rules)', () => {
  it('OWNER → FULL_ACCESS even when restrictive rules exist', () => {
    const rules = [personRule('p-person', DatabaseAccessLevel.CAN_VIEW)]
    expect(resolveRowAccess(memberCtx(RoleType.OWNER), rules, row(OTHER))).toBe(
      DatabaseAccessLevel.FULL_ACCESS,
    )
  })

  it('ADMIN → FULL_ACCESS even when restrictive rules exist', () => {
    const rules = [personRule('p-person', DatabaseAccessLevel.CAN_VIEW)]
    expect(resolveRowAccess(memberCtx(RoleType.ADMIN), rules, row(OTHER))).toBe(
      DatabaseAccessLevel.FULL_ACCESS,
    )
  })

  it('source page creator → FULL_ACCESS even when restrictive rules exist', () => {
    const rules = [personRule('p-person', DatabaseAccessLevel.CAN_VIEW)]
    const ctx = memberCtx(RoleType.VIEWER, { isSourcePageCreator: true })
    expect(resolveRowAccess(ctx, rules, row(OTHER))).toBe(DatabaseAccessLevel.FULL_ACCESS)
  })
})

describe('resolveRowAccess — restrictive mode (enabled rules present)', () => {
  it('plain VIEWER unmatched by any rule → null (THE key restrictive test)', () => {
    const rules = [personRule('p-person', DatabaseAccessLevel.CAN_VIEW)]
    // The row is assigned to someone else; the viewer has only a plain VIEWER role.
    const result = resolveRowAccess(
      memberCtx(RoleType.VIEWER),
      rules,
      row(OTHER, { 'p-person': OTHER }),
    )
    expect(result).toBeNull()
  })

  it('plain EDITOR unmatched by any rule → null (loses access once rules exist)', () => {
    const rules = [personRule('p-person', DatabaseAccessLevel.CAN_VIEW)]
    const result = resolveRowAccess(
      memberCtx(RoleType.EDITOR),
      rules,
      row(OTHER, { 'p-person': OTHER }),
    )
    expect(result).toBeNull()
  })

  it('CAN_VIEW PERSON rule where the cell === viewerId → CAN_VIEW', () => {
    const rules = [personRule('p-person', DatabaseAccessLevel.CAN_VIEW)]
    const result = resolveRowAccess(
      memberCtx(RoleType.VIEWER),
      rules,
      row(OTHER, { 'p-person': VIEWER }),
    )
    expect(result).toBe(DatabaseAccessLevel.CAN_VIEW)
  })

  it('CREATED_BY rule where rowCreatedById === viewerId → the rule level', () => {
    const rules = [createdByRule('p-created', DatabaseAccessLevel.CAN_EDIT_CONTENT)]
    const result = resolveRowAccess(memberCtx(RoleType.VIEWER), rules, row(VIEWER))
    expect(result).toBe(DatabaseAccessLevel.CAN_EDIT_CONTENT)
  })

  it('CREATED_BY rule where rowCreatedById !== viewerId → null for a plain member', () => {
    const rules = [createdByRule('p-created', DatabaseAccessLevel.CAN_EDIT_CONTENT)]
    const result = resolveRowAccess(memberCtx(RoleType.VIEWER), rules, row(OTHER))
    expect(result).toBeNull()
  })

  it('broadest-access-wins: CAN_VIEW rule match + pageShareLevel CAN_EDIT_CONTENT → CAN_EDIT_CONTENT', () => {
    const rules = [personRule('p-person', DatabaseAccessLevel.CAN_VIEW)]
    const ctx = memberCtx(RoleType.VIEWER, {
      pageShareLevel: DatabaseAccessLevel.CAN_EDIT_CONTENT,
    })
    const result = resolveRowAccess(ctx, rules, row(OTHER, { 'p-person': VIEWER }))
    expect(result).toBe(DatabaseAccessLevel.CAN_EDIT_CONTENT)
  })

  it('multiple matching rules → the MAX level', () => {
    const rules = [
      personRule('p-person', DatabaseAccessLevel.CAN_VIEW),
      createdByRule('p-created', DatabaseAccessLevel.CAN_EDIT),
    ]
    const result = resolveRowAccess(
      memberCtx(RoleType.VIEWER),
      rules,
      row(VIEWER, { 'p-person': VIEWER }),
    )
    expect(result).toBe(DatabaseAccessLevel.CAN_EDIT)
  })

  it('disabled rules are ignored when deciding restrictive vs open mode', () => {
    // Only a disabled rule present → behave as "no rules": role-derived level applies.
    const rules = [personRule('p-person', DatabaseAccessLevel.CAN_VIEW, false)]
    const result = resolveRowAccess(memberCtx(RoleType.EDITOR), rules, row(OTHER))
    expect(result).toBe(DatabaseAccessLevel.CAN_EDIT_CONTENT)
  })

  it('a share grant still applies in restrictive mode even with no rule match', () => {
    const rules = [personRule('p-person', DatabaseAccessLevel.CAN_VIEW)]
    const ctx = memberCtx(RoleType.VIEWER, { pageShareLevel: DatabaseAccessLevel.CAN_COMMENT })
    const result = resolveRowAccess(ctx, rules, row(OTHER, { 'p-person': OTHER }))
    expect(result).toBe(DatabaseAccessLevel.CAN_COMMENT)
  })

  it('anonymous (viewerId null) + rules → null', () => {
    const rules = [personRule('p-person', DatabaseAccessLevel.CAN_VIEW)]
    const ctx: RowAccessContext = {
      viewerId: null,
      workspaceRole: null,
      isSourcePageCreator: false,
      pageShareLevel: null,
    }
    expect(resolveRowAccess(ctx, rules, row(null, { 'p-person': null }))).toBeNull()
  })
})
