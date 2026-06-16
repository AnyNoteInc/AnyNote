import Link from 'next/link'

import {
  Box,
  Container,
  NotificationsIcon,
  Paper,
  SettingsIcon,
  Stack,
  Typography,
} from '@repo/ui/components'

import { ActivityGrid } from '@/components/profile/activity-grid'
import ProfileAvatarUploader from '@/components/profile/profile-avatar-uploader'
import { RecentActivity } from '@/components/profile/recent-activity'
import { requireSession } from '@/lib/get-session'
import { getServerTRPC } from '@/trpc/server'

export const metadata = { title: 'Мой профиль' }

export default async function ProfilePage() {
  const session = await requireSession()
  const trpc = await getServerTRPC()
  const activity = await trpc.user.activity()

  const initials =
    `${session.user.firstName.charAt(0)}${session.user.lastName.charAt(0)}`.toUpperCase()

  return (
    <Container maxWidth="md" sx={{ py: { xs: 4, md: 8 } }}>
      <Stack alignItems="center" spacing={3}>
        <ProfileAvatarUploader currentImage={session.user.image ?? null} initials={initials} />
        <Stack alignItems="center" spacing={0.5}>
          <Typography variant="h4">
            {session.user.firstName} {session.user.lastName}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {session.user.email}
          </Typography>
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ width: '100%', pt: 2 }}>
          <Link href="/settings" style={{ flex: 1, textDecoration: 'none' }}>
            <Paper
              variant="outlined"
              sx={{
                p: 2.5,
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                cursor: 'pointer',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <SettingsIcon />
              <Typography variant="body1">Настройки</Typography>
            </Paper>
          </Link>
          <Link href="/notifications" style={{ flex: 1, textDecoration: 'none' }}>
            <Paper
              variant="outlined"
              sx={{
                p: 2.5,
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                cursor: 'pointer',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <NotificationsIcon />
              <Typography variant="body1">Уведомления</Typography>
            </Paper>
          </Link>
        </Stack>

        <ActivityGrid grid={activity.grid} />

        <Box sx={{ width: '100%', pt: 2 }}>
          <Typography variant="overline" color="text.secondary">
            Последние действия
          </Typography>
          <RecentActivity
            actions={activity.recentActions.map((a) => ({
              action: a.action,
              pageId: a.pageId,
              pageTitle: a.pageTitle,
              createdAt: a.createdAt.toISOString(),
            }))}
          />
        </Box>
      </Stack>
    </Container>
  )
}
