import { notFound } from 'next/navigation'
import { getWorkspaceFeatures } from '@repo/trpc'

export default async function ChatsLayout({
  params,
  children,
}: {
  params: Promise<{ workspaceId: string }>
  children: React.ReactNode
}) {
  const { workspaceId } = await params
  const features = await getWorkspaceFeatures(workspaceId)
  if (!features.chatsEnabled) notFound()
  return <>{children}</>
}
