import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'

import '@repo/editor/styles'
import { EditorThemeBridge } from '@repo/editor'
import { prisma } from '@repo/db'
import { getCurrentConsents, hasAllRequiredConsents } from '@repo/trpc'

import { requireSession } from '@/lib/get-session'
import { TRPCReactProvider } from '@/trpc/client'
import { ServiceWorkerMount } from '@/components/notifications/service-worker-mount'

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const session = await requireSession()
  const consents = await getCurrentConsents(prisma, session.user.id)
  if (!hasAllRequiredConsents(consents)) {
    redirect('/onboarding/consents')
  }
  return (
    <TRPCReactProvider>
      <EditorThemeBridge />
      <ServiceWorkerMount />
      {children}
    </TRPCReactProvider>
  )
}
