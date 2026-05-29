import { describe, expect, it } from 'vitest'

import { scopesForRole } from '../src/lib/agents-token'

// Scopes the engines MCP tools require (mirror of tool_registry.py DEFAULT_ENGINES_TOOLS).
// If a new tool adds a scope, grant it in agents-token.ts or this guard fails.
const REQUIRED_READ = [
  'pages:read',
  'search:query',
  'files:read',
  'workspaces:read',
  'notifications:read',
  'favorites:read',
  'reminders:read',
] as const
const REQUIRED_WRITE = [
  'pages:write',
  'files:write',
  'reminders:write',
  'notifications:write',
  'favorites:write',
] as const

describe('scopesForRole grants every scope the MCP tool registry requires', () => {
  it('OWNER gets all required read + write scopes', () => {
    const owner = scopesForRole('OWNER')
    for (const s of [...REQUIRED_READ, ...REQUIRED_WRITE]) expect(owner).toContain(s)
  })

  it('EDITOR gets all required read + write scopes', () => {
    const editor = scopesForRole('EDITOR')
    for (const s of [...REQUIRED_READ, ...REQUIRED_WRITE]) expect(editor).toContain(s)
  })

  it('VIEWER gets the required read scopes but not the writes', () => {
    const viewer = scopesForRole('VIEWER')
    for (const s of REQUIRED_READ) expect(viewer).toContain(s)
    for (const s of REQUIRED_WRITE) expect(viewer).not.toContain(s)
  })
})
