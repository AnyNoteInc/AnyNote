import { redirect } from 'next/navigation'

import { Container } from '@repo/ui/components'

import { getServerTRPC } from '@/trpc/server'
import { NewWorkspaceForm } from '@/components/workspace/new-workspace-form'

export const metadata = { title: 'Новое пространство' }

export default async function NewWorkspacePage() {
  const trpc = await getServerTRPC()

  // A plan-maxed user (e.g. Pro + 3 workspaces) must never be shown the create
  // form: submitting it always 403s with the plan-limit error. When they have a
  // usable workspace, send them into it instead of this dead-end. `/app`
  // re-resolves (and repairs) the active workspace, so this also covers the
  // reported case where activeWorkspaceId was stale/null. Both reads default to
  // "allow the form" on error — the create mutation stays the real gate.
  const [gate, active] = await Promise.all([
    trpc.workspace.canCreate().catch(() => null),
    trpc.workspace.getActive().catch(() => null),
  ])
  if (gate && !gate.allowed && active) redirect('/app')

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <NewWorkspaceForm />
    </Container>
  )
}
