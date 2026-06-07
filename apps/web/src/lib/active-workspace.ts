import 'server-only'

import { prisma } from '@repo/db'
import { resolveActiveWorkspace } from '@repo/trpc'

export function getActiveWorkspaceForUser(userId: string) {
  return resolveActiveWorkspace(prisma, userId)
}
