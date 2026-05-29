import type { PrismaClient } from '@repo/db'
import { forbidden } from '../errors.ts'

export async function assertWorkspaceMembership(
  prisma: PrismaClient,
  userId: string,
  workspaceId: string,
) {
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  })
  if (!member) {
    throw forbidden('Вы не являетесь участником воркспейса')
  }
  return member
}
