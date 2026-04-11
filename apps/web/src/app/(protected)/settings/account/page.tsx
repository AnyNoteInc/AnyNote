import { Stack, Typography } from "@repo/ui/components"

import { SessionsTable } from "@/components/settings/sessions-table"
import { SignOutButton } from "@/components/settings/sign-out-button"
import { getSession } from "@/lib/get-session"

export const metadata = { title: "Аккаунт · Настройки" }

export default async function AccountSettingsPage() {
  const session = await getSession()
  const currentSessionId = session!.session.id

  return (
    <Stack spacing={3}>
      <Stack spacing={0.5}>
        <Typography variant="h5" fontWeight={700}>Аккаунт</Typography>
        <Typography variant="body2" color="text.secondary">
          Выход из системы и активные сессии
        </Typography>
      </Stack>
      <SignOutButton />
      <Stack spacing={1}>
        <Typography variant="subtitle1" fontWeight={700}>Активные сессии</Typography>
        <SessionsTable currentSessionId={currentSessionId} />
      </Stack>
    </Stack>
  )
}
