import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { prisma } from '@repo/db'

import { getSession } from '@/lib/get-session'
import { getServerTRPC } from '@/trpc/server'
import { resolveShareAccess } from '@/lib/share-access'
import { shareRobots } from '@/lib/share-metadata'
import { ShareUnavailable, SharePasswordGate } from '@/components/share/share-unavailable'

import { SharePageView } from './share-page-view'

// Per-page robots policy (replaces the old blanket layout-level noindex). A
// share is indexable only when it is a published SITE with `allowIndexing` on —
// derived from the public publish state, independent of who is viewing. Robots
// must NOT depend on a privileged member's bypass, so we read the raw publish
// columns here rather than the access-resolved view.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ shareId: string }>
}): Promise<Metadata> {
  const { shareId } = await params
  const share = await prisma.pageShare.findUnique({
    where: { shareId },
    select: {
      mode: true,
      publishedAt: true,
      unpublishedAt: true,
      allowIndexing: true,
      page: { select: { title: true } },
    },
  })

  const published =
    share?.publishedAt != null &&
    (share.unpublishedAt == null || share.unpublishedAt.getTime() < share.publishedAt.getTime())
  const { index } = shareRobots({
    mode: (share?.mode as 'LINK' | 'SITE') ?? 'LINK',
    published,
    allowIndexing: share?.allowIndexing ?? false,
  })

  return {
    title: share?.page.title || 'Общий доступ',
    robots: { index, follow: index },
  }
}

export default async function SharePage({
  params,
  searchParams,
}: {
  params: Promise<{ shareId: string }>
  searchParams: Promise<{ pw?: string }>
}) {
  const { shareId } = await params
  const { pw } = await searchParams
  const session = await getSession()
  const resolved = await resolveShareAccess(prisma, shareId, session, { password: pw })

  if (resolved.kind === 'not_found') notFound()

  if (resolved.kind === 'unavailable') {
    // Password gate validates client-side then re-renders with `?pw=`; every
    // other reason renders a flat per-reason message.
    if (resolved.reason === 'password_required') {
      return <SharePasswordGate shareId={shareId} />
    }
    return <ShareUnavailable reason={resolved.reason} />
  }

  // SITE shares expose a navigable subtree; the resolver-validated tRPC query
  // is the single authority for which subpages are public.
  let tree: {
    rootId: string | null
    rootTitle: string | null
    rootIcon: string | null
    nodes: { id: string; title: string | null; icon: string | null; parentId: string | null }[]
  } = { rootId: null, rootTitle: null, rootIcon: null, nodes: [] }

  if (resolved.share.mode === 'SITE') {
    const trpc = await getServerTRPC()
    const result = await trpc.page.share.publicTree({ shareId, password: pw })
    tree = {
      rootId: result.rootId,
      rootTitle: result.rootTitle,
      rootIcon: result.rootIcon,
      nodes: result.nodes,
    }
  }

  return (
    <SharePageView
      shareId={shareId}
      resolved={resolved}
      session={session}
      tree={tree}
      password={pw}
    />
  )
}
