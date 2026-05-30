import type { Domain } from '@repo/domain'

/**
 * Build a fake Domain facade for MCP service unit tests.
 *
 * All 7 sub-facades default to empty stubs; pass `overrides` to wire the
 * one(s) the service under test actually calls (typically a small object of
 * `jest.fn()` spies cast to the matching `Domain['<facade>']` type).
 *
 * This file lives outside the `*.spec.ts` glob so jest does not collect it as
 * a (testless) suite.
 */
export function makeFakeDomain(overrides: Partial<Domain> = {}): Domain {
  return {
    workspace: {},
    favorites: {},
    notifications: {},
    reminders: {},
    kanban: {},
    pages: {},
    billing: {},
    ...overrides,
  } as unknown as Domain
}
