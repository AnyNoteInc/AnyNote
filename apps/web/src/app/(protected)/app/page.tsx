import { redirect } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'

export default async function AppIndexPage() {
  const trpc = await getServerTRPC()
  const defaultWorkspace = await trpc.workspace.getDefault()
  if (!defaultWorkspace) redirect('/workspaces/new')
  redirect(`/workspaces/${defaultWorkspace.id}`)
}
