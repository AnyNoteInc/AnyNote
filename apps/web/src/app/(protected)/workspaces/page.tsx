import { redirect } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'

export default async function WorkspacesIndexRedirect() {
  const trpc = await getServerTRPC()
  const defaultWorkspace = await trpc.workspace.getDefault()
  if (defaultWorkspace) {
    redirect(`/workspaces/${defaultWorkspace.id}`)
  }
  const owned = await trpc.workspace.listMine()
  if (owned.length > 0) {
    redirect(`/workspaces/${owned[0]!.id}`)
  }
  redirect('/workspaces/new')
}
