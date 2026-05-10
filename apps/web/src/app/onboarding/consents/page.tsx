import { redirect } from 'next/navigation'

import { Typography } from '@repo/ui/components'
import { prisma } from '@repo/db'
import { getCurrentConsents, hasAllRequiredConsents } from '@repo/trpc'

import { requireSession } from '@/lib/get-session'

import { ConsentsOnboardingForm } from './consents-form'

export default async function OnboardingConsentsPage() {
  const session = await requireSession()
  const current = await getCurrentConsents(prisma, session.user.id)
  if (hasAllRequiredConsents(current)) {
    redirect('/profile')
  }
  return (
    <>
      <Typography variant="h5" component="h1">
        Завершите регистрацию
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Для использования сервиса требуется принятие следующих документов.
      </Typography>
      <ConsentsOnboardingForm />
    </>
  )
}
