import { notFound } from "next/navigation"

import { getServerTRPC } from "@/trpc/server"
import { PageView } from "@/components/page/page-view"

type Props = { params: Promise<{ workspaceId: string }> }

export default async function WorkspaceRootPage({ params }: Props) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const pages = await trpc.page.listByWorkspace({ workspaceId })
  if (pages.length === 0) notFound()

  const firstPage = pages[0]!
  const [page, blocks] = await Promise.all([
    trpc.page.getById({ id: firstPage.id }),
    trpc.block.listByPage({ pageId: firstPage.id }),
  ])

  return <PageView page={page} blocks={blocks} />
}
