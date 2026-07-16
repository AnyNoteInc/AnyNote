import { Prisma } from '@repo/db'

import type { Db } from './unit-of-work.ts'

/** Canonical parent lock for workspace-scoped transactions that lock child rows. */
export async function lockWorkspaceForMutation(client: Db, workspaceId: string): Promise<boolean> {
  const rows = await client.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id
    FROM workspaces
    WHERE id = ${workspaceId}::uuid
    FOR UPDATE
  `)
  return rows.length === 1
}
