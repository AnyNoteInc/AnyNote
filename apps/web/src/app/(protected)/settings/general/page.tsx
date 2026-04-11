import { Stack, Typography } from "@repo/ui/components"

import { NotificationsSection } from "@/components/settings/notifications-section"
import { ProfileSection } from "@/components/settings/profile-section"
import { ThemeSection } from "@/components/settings/theme-section"
import { getSession } from "@/lib/get-session"
import { getServerTRPC } from "@/trpc/server"

export const metadata = { title: "Общее · Настройки" }

type NotificationSettings = {
  email: { mentions: boolean; comments: boolean; weeklyDigest: boolean }
}

export default async function GeneralSettingsPage() {
  const session = await getSession()
  const user = session!.user
  const trpc = await getServerTRPC()
  const prefs = await trpc.user.getPreferences()

  return (
    <Stack spacing={2}>
      <Stack spacing={0.5} sx={{ mb: 1 }}>
        <Typography variant="h5" fontWeight={700}>Общее</Typography>
        <Typography variant="body2" color="text.secondary">
          Настройки профиля, темы и уведомлений
        </Typography>
      </Stack>
      <ProfileSection
        initial={{
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          emailVerified: user.emailVerified,
          image: user.image ?? null,
        }}
      />
      <ThemeSection initial={(prefs?.theme as "light" | "dark" | "system" | null) ?? null} />
      <NotificationsSection
        initial={(prefs?.notificationSettings as NotificationSettings | null) ?? null}
      />
    </Stack>
  )
}
