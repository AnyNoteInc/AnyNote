import { describe, expect, it, vi } from 'vitest'

import { assertCanEditDatabaseStructure } from '../../../src/database/services/database-structure-access.ts'

const source = {
  workspaceId: 'workspace-1',
  pageCreatedById: 'creator-1',
  structureLocked: false,
}

const repositoryWithRole = (role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER' | null) => ({
  findWorkspaceRole: vi.fn(async () => role),
})

describe('assertCanEditDatabaseStructure', () => {
  it.each(['OWNER', 'ADMIN'] as const)('always allows workspace %s', async (role) => {
    await expect(
      assertCanEditDatabaseStructure(repositoryWithRole(role), 'other-user', {
        ...source,
        structureLocked: true,
      }),
    ).resolves.toBeUndefined()
  })

  it('allows the source page creator while the structure is unlocked', async () => {
    await expect(
      assertCanEditDatabaseStructure(repositoryWithRole('EDITOR'), 'creator-1', source),
    ).resolves.toBeUndefined()
  })

  it.each(['EDITOR', 'VIEWER', null] as const)(
    'rejects a non-creator with role %s using the insufficient-rights error',
    async (role) => {
      await expect(
        assertCanEditDatabaseStructure(repositoryWithRole(role), 'other-user', source),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: 'Недостаточно прав для изменения структуры',
      })
    },
  )

  it('rejects the creator while locked with the locked-structure error', async () => {
    await expect(
      assertCanEditDatabaseStructure(repositoryWithRole('EDITOR'), 'creator-1', {
        ...source,
        structureLocked: true,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Структура заблокирована' })
  })
})
