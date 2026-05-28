import { redirect } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'

export default async function LegacyMcpRedirect() {
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getDefault()
  redirect(workspace ? `/workspaces/${workspace.id}/settings/mcp` : '/workspaces')
}
