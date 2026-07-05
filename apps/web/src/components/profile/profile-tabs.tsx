'use client'

import { useState } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import {
  AddIcon,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@repo/ui/components'

import { WorkspaceAvatar } from '@/components/workspace/workspace-avatar'
import { trpc } from '@/trpc/client'

import { RecentActivity } from './recent-activity'

type WorkspaceItem = {
  accessKind: 'member' | 'guest'
  icon: string | null
  id: string
  name: string
}

type Action = {
  action: string
  createdAt: string
  pageId: string
  pageTitle: string | null
}

type TabValue = 'workspaces' | 'activity'

export function ProfileTabs({
  workspaces,
  activeWorkspaceId,
  actions,
}: Readonly<{
  actions: Action[]
  activeWorkspaceId: string | null
  workspaces: WorkspaceItem[]
}>) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const [tab, setTab] = useState<TabValue>('workspaces')

  // Same switch flow as the sidebar switcher: setActive server-side, then the
  // scope-dependent caches are stale — invalidate before landing on /app.
  const setActive = trpc.workspace.setActive.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.page.listByWorkspace.invalidate(),
        utils.page.listFavorites.invalidate(),
        utils.chat.listChats.invalidate(),
        utils.workspace.getActive.invalidate(),
      ])
      router.push('/app')
      router.refresh()
    },
  })

  const openWorkspace = (workspaceId: string) => {
    if (setActive.isPending) return
    if (workspaceId === activeWorkspaceId) {
      router.push('/app')
      return
    }
    setActive.mutate({ workspaceId })
  }

  return (
    <Box sx={{ width: '100%', pt: 2 }}>
      <Tabs
        value={tab}
        onChange={(_event, value: TabValue) => setTab(value)}
        sx={{ borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab value="workspaces" label="Мои пространства" data-testid="profile-tab-workspaces" />
        <Tab value="activity" label="Последние действия" data-testid="profile-tab-activity" />
      </Tabs>

      {tab === 'workspaces' ? (
        <Stack spacing={1} sx={{ mt: 1, width: '100%' }}>
          {workspaces.length === 0 ? (
            <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                У вас пока нет пространств
              </Typography>
            </Paper>
          ) : (
            workspaces.map((w) => (
              <Paper
                key={w.id}
                variant="outlined"
                onClick={() => openWorkspace(w.id)}
                data-testid="profile-workspace-card"
                sx={{
                  p: 1.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  cursor: 'pointer',
                  opacity: setActive.isPending ? 0.6 : 1,
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <WorkspaceAvatar icon={w.icon} />
                <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
                  {w.name}
                </Typography>
                {w.accessKind === 'guest' ? (
                  <Chip label="Гость" size="small" variant="outlined" data-testid="guest-chip" />
                ) : null}
                {w.id === activeWorkspaceId ? (
                  <Chip label="Текущее" size="small" color="primary" variant="outlined" />
                ) : null}
              </Paper>
            ))
          )}
          <Box>
            <Link href="/workspaces/new" style={{ textDecoration: 'none' }}>
              <Button startIcon={<AddIcon />} sx={{ textTransform: 'none' }}>
                Создать пространство
              </Button>
            </Link>
          </Box>
        </Stack>
      ) : (
        <RecentActivity actions={actions} />
      )}
    </Box>
  )
}
