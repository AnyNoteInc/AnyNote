import 'server-only'

import type { PrismaClient, PageType } from '@repo/db'

export type EffectiveRole = 'OWNER' | 'EDITOR' | 'COMMENTER' | 'READER'

type SessionLike = { user: { id: string } } | null

type SharePage = {
  id: string
  type: PageType
  title: string | null
  icon: string | null
  contentYjs: Uint8Array | Buffer | null
  workspaceId: string
  createdById: string | null
}

export function mapMemberRole(role: string): EffectiveRole {
  switch (role) {
    case 'OWNER':
      return 'OWNER'
    case 'ADMIN':
    case 'EDITOR':
      return 'EDITOR'
    case 'COMMENTER':
      return 'COMMENTER'
    default:
      return 'READER' // VIEWER, GUEST
  }
}

/**
 * Single viewing-resolution authority. Priority:
 *   workspace member ▸ named grant ▸ public link role ▸ deny.
 * `share === null` => the link does not exist (caller should 404).
 */
export async function resolveShareAccess(
  prisma: Pick<PrismaClient, 'pageShare' | 'workspaceMember' | 'pageShareUser'>,
  shareId: string,
  session: SessionLike,
): Promise<{ share: { id: string } | null; page: SharePage | null; role: EffectiveRole | null }> {
  const share = await prisma.pageShare.findUnique({
    where: { shareId },
    select: {
      id: true,
      access: true,
      linkRole: true,
      page: {
        select: {
          id: true,
          type: true,
          title: true,
          icon: true,
          contentYjs: true,
          workspaceId: true,
          createdById: true,
        },
      },
    },
  })
  if (!share) return { share: null, page: null, role: null }

  const page = share.page as SharePage

  if (session?.user) {
    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: page.workspaceId, userId: session.user.id } },
      select: { role: true },
    })
    if (member) return { share, page, role: mapMemberRole(member.role) }

    const grant = await prisma.pageShareUser.findFirst({
      where: { pageShareId: share.id, userId: session.user.id },
      select: { role: true },
    })
    if (grant) return { share, page, role: grant.role as EffectiveRole }
  }

  if (share.access === 'PUBLIC') {
    return { share, page, role: share.linkRole as EffectiveRole }
  }

  return { share, page, role: null }
}
