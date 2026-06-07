import type { ReactNode } from 'react'

import { redirect } from 'next/navigation'

import { getWorkspaceFeatures } from '@repo/trpc'

import { requireSession } from '@/lib/get-session'
import { getServerTRPC } from '@/trpc/server'
import { PlanFeaturesProvider } from '@/components/workspace/plan-features-context'
import { WorkspaceLayoutClient } from '@/components/workspace/workspace-layout-client'

export default async function ActiveWorkspaceLayout({ children }: { children: ReactNode }) {
  const session = await requireSession()
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getActive()
  if (!workspace) redirect('/workspaces/new')

  const pages = await trpc.page.listByWorkspace({ workspaceId: workspace.id })
  const features = await getWorkspaceFeatures(workspace.id)

  return (
    <PlanFeaturesProvider features={features}>
      <WorkspaceLayoutClient
        workspace={{ id: workspace.id, name: workspace.name, icon: workspace.icon }}
        features={features}
        pages={pages}
        user={{
          id: session.user.id,
          firstName: session.user.firstName,
          lastName: session.user.lastName,
          email: session.user.email,
          image: session.user.image ?? null,
        }}
      >
        {children}
      </WorkspaceLayoutClient>
    </PlanFeaturesProvider>
  )
}
