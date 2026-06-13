import type { ReactNode } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import '@repo/editor/styles'
import { EditorThemeBridge } from '@repo/editor'
import { prisma } from '@repo/db'
import { getCurrentConsents, hasAllRequiredConsents } from '@repo/trpc'

import { requireSession } from '@/lib/get-session'
import { INVITE_RETURN_COOKIE, isInvitePath } from '@/lib/invite'
import { TRPCReactProvider } from '@/trpc/client'
import { ServiceWorkerMount } from '@/components/notifications/service-worker-mount'
import { InstallPromptBanner } from '@/components/pwa/install-prompt-banner'
import { PwaInstallProvider } from '@/components/pwa/pwa-install-context'

export { NOINDEX_METADATA as metadata } from '@/lib/seo/build-metadata'

export default async function ProtectedLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await requireSession()
  const consents = await getCurrentConsents(prisma, session.user.id)
  if (!hasAllRequiredConsents(consents)) {
    redirect('/onboarding/consents')
  }
  // Post-auth invite return (set by /api/invite/return): bounce once to the
  // invite page through the consume handler — a layout cannot delete the
  // cookie itself. Runs after the consents gate so onboarding stays first.
  const inviteReturn = (await cookies()).get(INVITE_RETURN_COOKIE)?.value
  if (inviteReturn && isInvitePath(inviteReturn)) {
    redirect('/api/invite/return/consume')
  }
  return (
    <TRPCReactProvider>
      <EditorThemeBridge />
      <ServiceWorkerMount />
      <PwaInstallProvider>
        {children}
        <InstallPromptBanner />
      </PwaInstallProvider>
    </TRPCReactProvider>
  )
}
