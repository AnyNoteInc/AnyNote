import { Stack, Typography } from '@repo/ui/components'

import { PreferencesMatrix } from '@/components/settings/preferences-matrix'
import { ProfileSection } from '@/components/settings/profile-section'
import { PwaHelpCard } from '@/components/settings/pwa-help-card'
import { ThemeSection } from '@/components/settings/theme-section'
import { getSession } from '@/lib/get-session'

export const metadata = { title: 'Общее · Настройки' }

export default async function GeneralSettingsPage() {
  const session = await getSession()
  const user = session!.user

  return (
    <Stack spacing={2}>
      <Stack spacing={0.5} sx={{ mb: 1 }}>
        <Typography variant="h5" fontWeight={700}>
          Общее
        </Typography>
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
      <ThemeSection />
      <PreferencesMatrix />
      <PwaHelpCard />
    </Stack>
  )
}
