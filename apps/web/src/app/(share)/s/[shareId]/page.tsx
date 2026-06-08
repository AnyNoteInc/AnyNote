import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { randomUUID } from 'node:crypto'

import { prisma } from '@repo/db'
import { Box, Button, PublicIcon, Stack, Typography } from '@repo/ui/components'

import { getSession } from '@/lib/get-session'
import { resolveShareAccess } from '@/lib/share-access'
import { shareRobots } from '@/lib/share-metadata'
import { PageCommentsProvider } from '@/components/page/comments/comments-context'
import { CommentToggleButton } from '@/components/page/comments/comment-toggle-button'
import { CommentsSidebar } from '@/components/page/comments/comments-sidebar'
import { ShareUnavailable, SharePasswordGate } from '@/components/share/share-unavailable'

import { SharePageClient } from './share-page-client'

// Per-page robots policy (replaces the old blanket layout-level noindex). A
// share is indexable only when it is a published SITE with `allowIndexing` on —
// derived from the public publish state, independent of who is viewing. Robots
// must NOT depend on a privileged member's bypass, so we read the raw publish
// columns here rather than the access-resolved view.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ shareId: string }>
}): Promise<Metadata> {
  const { shareId } = await params
  const share = await prisma.pageShare.findUnique({
    where: { shareId },
    select: {
      mode: true,
      publishedAt: true,
      unpublishedAt: true,
      allowIndexing: true,
      page: { select: { title: true } },
    },
  })

  const published =
    share?.publishedAt != null &&
    (share.unpublishedAt == null || share.unpublishedAt.getTime() < share.publishedAt.getTime())
  const { index } = shareRobots({
    mode: (share?.mode as 'LINK' | 'SITE') ?? 'LINK',
    published,
    allowIndexing: share?.allowIndexing ?? false,
  })

  return {
    title: share?.page.title || 'Общий доступ',
    robots: { index, follow: index },
  }
}

const COLORS = ['#1976d2', '#9c27b0', '#2e7d32', '#ed6c02', '#0288d1', '#d32f2f']
const ANIMALS = ['Лис', 'Кот', 'Барс', 'Сокол', 'Ёж', 'Бобр', 'Тур', 'Краб']

function hash(s: string): number {
  let h = 0
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0
  return h
}

export default async function SharePage({
  params,
  searchParams,
}: {
  params: Promise<{ shareId: string }>
  searchParams: Promise<{ pw?: string }>
}) {
  const { shareId } = await params
  const { pw } = await searchParams
  const session = await getSession()
  const resolved = await resolveShareAccess(prisma, shareId, session, { password: pw })

  if (resolved.kind === 'not_found') notFound()

  if (resolved.kind === 'unavailable') {
    // Password gate validates client-side then re-renders with `?pw=`; every
    // other reason renders a flat per-reason message.
    if (resolved.reason === 'password_required') {
      return <SharePasswordGate shareId={shareId} />
    }
    return <ShareUnavailable reason={resolved.reason} />
  }

  const { page, role } = resolved
  const editable = role === 'EDITOR' || role === 'OWNER'
  const contentYjs = page.contentYjs ? Buffer.from(page.contentYjs).toString('base64') : null

  const user = session?.user
    ? {
        id: session.user.id,
        name:
          [session.user.firstName, session.user.lastName].filter(Boolean).join(' ').trim() ||
          session.user.email,
        color: COLORS[Math.abs(hash(session.user.id)) % COLORS.length]!,
      }
    : {
        id: `anon:${randomUUID()}`,
        name: `Гость · ${ANIMALS[Math.floor(Math.random() * ANIMALS.length)]}`,
        color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
      }

  return (
    <PageCommentsProvider
      target={{ shareId }}
      pageType={page.type}
      canComment={role !== 'READER'}
      canDeleteComments={false}
      workspaceId={page.workspaceId}
    >
      <Box sx={{ display: 'flex', height: '100vh', minHeight: 0 }}>
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Stack
            direction="row"
            alignItems="center"
            spacing={1}
            sx={{ px: 3, py: 1.5, borderBottom: 1, borderColor: 'divider' }}
          >
            {page.icon ? <span>{page.icon}</span> : null}
            <Typography variant="subtitle1" sx={{ flex: 1 }} noWrap>
              {page.title || 'Без названия'}
            </Typography>
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: 'text.secondary' }}>
              <PublicIcon sx={{ fontSize: 18 }} />
              <Typography variant="caption">Общий доступ</Typography>
            </Stack>
            {!editable && (
              <Typography variant="caption" color="text.secondary">
                Только просмотр
              </Typography>
            )}
            <CommentToggleButton />
            {!session && (
              <Button size="small" href={`/sign-in?redirect=/s/${shareId}`}>
                Войти
              </Button>
            )}
          </Stack>
          <Box className="share-page-content" sx={{ flex: 1, minHeight: 0, minWidth: 0 }}>
            <SharePageClient
              shareId={shareId}
              page={{ id: page.id, type: page.type, contentYjs }}
              workspaceId={page.workspaceId}
              user={user}
              editable={editable}
            />
          </Box>
        </Box>
        <CommentsSidebar />
      </Box>
    </PageCommentsProvider>
  )
}
