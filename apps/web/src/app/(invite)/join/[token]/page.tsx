import type { Metadata } from 'next'

import { getSession } from '@/lib/get-session'
import { getServerTRPC } from '@/trpc/server'
import { isWellFormedInviteToken } from '@/lib/invite'
import { InviteCard } from '@/components/invite/invite-card'

export const metadata: Metadata = {
  title: 'Присоединиться к пространству',
}

export default async function JoinTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!isWellFormedInviteToken(token)) {
    return (
      <InviteCard
        kind="join"
        token={token}
        state="NOT_FOUND"
        workspaceName={null}
        inviterName={null}
        role={null}
        maskedEmail={null}
        sessionEmail={null}
        emailMatches={false}
      />
    )
  }

  const trpc = await getServerTRPC()
  const [resolved, session] = await Promise.all([
    trpc.people.resolveJoinLink({ token }),
    getSession(),
  ])

  return (
    <InviteCard
      kind="join"
      token={token}
      state={resolved.state}
      workspaceName={resolved.workspaceName}
      inviterName={null}
      role={resolved.role}
      maskedEmail={null}
      sessionEmail={session?.user.email ?? null}
      // Join links carry no email constraint — any signed-in account may join.
      emailMatches
    />
  )
}
