import type { Metadata } from 'next'

import { getSession } from '@/lib/get-session'
import { getServerTRPC } from '@/trpc/server'
import { inviteEmailMatches, isWellFormedInviteToken } from '@/lib/invite'
import { InviteCard } from '@/components/invite/invite-card'

export const metadata: Metadata = {
  title: 'Приглашение в пространство',
}

export default async function InviteTokenPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  if (!isWellFormedInviteToken(token)) {
    return (
      <InviteCard
        kind="invite"
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
  const [resolved, session] = await Promise.all([trpc.people.resolveInvite({ token }), getSession()])
  const sessionEmail = session?.user.email ?? null
  const emailMatches =
    resolved.state === 'PENDING' && sessionEmail !== null
      ? await inviteEmailMatches('invite', token, sessionEmail)
      : false

  return (
    <InviteCard
      kind="invite"
      token={token}
      state={resolved.state}
      workspaceName={resolved.workspaceName}
      inviterName={resolved.inviterName}
      role={resolved.role}
      maskedEmail={resolved.maskedEmail}
      sessionEmail={sessionEmail}
      emailMatches={emailMatches}
    />
  )
}
