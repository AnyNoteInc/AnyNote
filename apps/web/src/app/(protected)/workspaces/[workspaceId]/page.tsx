import { redirect } from 'next/navigation'

type Props = { params: Promise<{ workspaceId: string }> }

export default async function WorkspaceRootPage({ params }: Props) {
  const { workspaceId } = await params
  redirect(`/workspaces/${workspaceId}/chats/new`)
}
