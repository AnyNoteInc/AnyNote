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

const uuidList = (ids: readonly string[]) => Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))

/** Lock Page parents in stable UUID order after the workspace parent is held. */
export async function lockPagesForMutation(
  client: Db,
  pageIds: readonly string[],
): Promise<boolean> {
  const ids = [...new Set(pageIds)].sort()
  if (ids.length === 0) return true
  const rows = await client.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id
    FROM pages
    WHERE id IN (${uuidList(ids)})
    ORDER BY id
    FOR UPDATE
  `)
  return rows.length === ids.length
}

/** Lock DatabaseRow children in stable UUID order after their Page parents. */
export async function lockDatabaseRowsForMutation(
  client: Db,
  rowIds: readonly string[],
): Promise<boolean> {
  const ids = [...new Set(rowIds)].sort()
  if (ids.length === 0) return true
  const rows = await client.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id
    FROM database_rows
    WHERE id IN (${uuidList(ids)})
    ORDER BY id
    FOR UPDATE
  `)
  return rows.length === ids.length
}

/** Canonical lock graph for mutations that touch item pages and database rows. */
export async function lockWorkspacePagesAndRowsForMutation(
  client: Db,
  input: { workspaceId: string; pageIds: readonly string[]; rowIds: readonly string[] },
): Promise<boolean> {
  if (!(await lockWorkspaceForMutation(client, input.workspaceId))) return false
  if (!(await lockPagesForMutation(client, input.pageIds))) return false
  return lockDatabaseRowsForMutation(client, input.rowIds)
}
