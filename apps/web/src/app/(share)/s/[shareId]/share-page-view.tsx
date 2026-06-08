import { randomUUID } from 'node:crypto'

import { Box, Button, PublicIcon, Stack, Typography } from '@repo/ui/components'

import type { ShareAccessResult } from '@/lib/share-access'
import { PageCommentsProvider } from '@/components/page/comments/comments-context'
import { CommentToggleButton } from '@/components/page/comments/comment-toggle-button'
import { CommentsSidebar } from '@/components/page/comments/comments-sidebar'
import {
  PublicShareTreeNav,
  type ShareTreeNode,
} from '@/components/share/public-share-tree-nav'

import { SharePageClient } from './share-page-client'

const COLORS = ['#1976d2', '#9c27b0', '#2e7d32', '#ed6c02', '#0288d1', '#d32f2f']
const ANIMALS = ['Лис', 'Кот', 'Барс', 'Сокол', 'Ёж', 'Бобр', 'Тур', 'Краб']

function hash(s: string): number {
  let h = 0
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0
  return h
}

type SessionLike = {
  user?: { id: string; firstName?: string | null; lastName?: string | null; email: string }
} | null

// Shared shell for both the share root and nested child routes: header, the
// optional SITE navigation tree, the collaborative renderer, the copy button,
// and the comments sidebar. `resolved` is the granted (member/grant/public)
// access result; `tree` is the published subtree (empty for LINK).
export function SharePageView({
  shareId,
  resolved,
  session,
  tree,
  copyButton,
}: {
  shareId: string
  resolved: Extract<ShareAccessResult, { kind: 'member' | 'grant' | 'public' }>
  session: SessionLike
  tree: { rootId: string | null; rootTitle: string | null; rootIcon: string | null; nodes: ShareTreeNode[] }
  copyButton?: React.ReactNode
}) {
  const { page, role, share } = resolved
  const editable = role === 'EDITOR' || role === 'OWNER'
  const contentYjs = page.contentYjs ? Buffer.from(page.contentYjs).toString('base64') : null
  const isSite = share.mode === 'SITE'

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
        {isSite && tree.rootId ? (
          <PublicShareTreeNav
            shareId={shareId}
            rootId={tree.rootId}
            rootTitle={tree.rootTitle}
            rootIcon={tree.rootIcon}
            nodes={tree.nodes}
          />
        ) : null}
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
            {copyButton}
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
