import { notFound } from 'next/navigation'
import { randomUUID } from 'node:crypto'

import { prisma } from '@repo/db'
import { Box, Button, LockIcon, PublicIcon, Stack, Typography } from '@repo/ui/components'

import { getSession } from '@/lib/get-session'
import { resolveShareAccess } from '@/lib/share-access'

import { SharePageClient } from './share-page-client'

const COLORS = ['#1976d2', '#9c27b0', '#2e7d32', '#ed6c02', '#0288d1', '#d32f2f']
const ANIMALS = ['Лис', 'Кот', 'Барс', 'Сокол', 'Ёж', 'Бобр', 'Тур', 'Краб']

function hash(s: string): number {
  let h = 0
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0
  return h
}

export default async function SharePage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params
  const session = await getSession()
  const { share, page, role } = await resolveShareAccess(prisma, shareId, session)

  if (!share || !page) notFound()

  if (!role) {
    return (
      <Box
        sx={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', p: 3 }}
      >
        <Stack spacing={2} alignItems="center">
          <LockIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
          <Typography variant="h6">Нет доступа</Typography>
          <Typography color="text.secondary" textAlign="center">
            Открывать этот контент могут только пользователи, имеющие доступ.
          </Typography>
          {!session && (
            <Button variant="contained" href={`/sign-in?redirect=/s/${shareId}`}>
              Войти
            </Button>
          )}
        </Stack>
      </Box>
    )
  }

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
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', minHeight: 0 }}>
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
        {!session && (
          <Button size="small" href={`/sign-in?redirect=/s/${shareId}`}>
            Войти
          </Button>
        )}
      </Stack>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <SharePageClient
          shareId={shareId}
          page={{ id: page.id, type: page.type as never, contentYjs }}
          workspaceId={page.workspaceId}
          user={user}
          editable={editable}
        />
      </Box>
    </Box>
  )
}
