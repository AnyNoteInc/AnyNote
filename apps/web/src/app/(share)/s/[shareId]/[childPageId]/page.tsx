import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { prisma } from '@repo/db'

import { getSession } from '@/lib/get-session'
import { getServerTRPC } from '@/trpc/server'
import { resolveShareAccess } from '@/lib/share-access'
import { shareRobots } from '@/lib/share-metadata'
import { ShareUnavailable, SharePasswordGate } from '@/components/share/share-unavailable'

import { SharePageView } from '../share-page-view'

// Robots for a deep-linked subpage follow the parent SITE's publish/indexing
// policy (a subpage is never more indexable than its site). The raw publish
// columns are read directly so robots do not depend on a privileged member's
// bypass. The child title is taken ONLY from the access-resolved page — never
// from an unguarded lookup — so a valid shareId + an arbitrary page UUID cannot
// be used as a title-leak oracle for a page outside the published subtree.
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ shareId: string; childPageId: string }>
  searchParams: Promise<{ pw?: string }>
}): Promise<Metadata> {
  const { shareId, childPageId } = await params
  const { pw } = await searchParams
  const share = await prisma.pageShare.findUnique({
    where: { shareId },
    select: { mode: true, publishedAt: true, unpublishedAt: true, allowIndexing: true },
  })

  const published =
    share?.publishedAt != null &&
    (share.unpublishedAt == null || share.unpublishedAt.getTime() < share.publishedAt.getTime())
  const { index } = shareRobots({
    mode: (share?.mode as 'LINK' | 'SITE') ?? 'LINK',
    published,
    allowIndexing: share?.allowIndexing ?? false,
  })

  // Only surface the child title when the resolver actually grants access to it
  // (public visitor, named grant, or workspace member). An unavailable/not_found
  // result falls back to a generic title, so this route is never a title-leak
  // oracle for pages outside the published subtree.
  const session = await getSession()
  const resolved = await resolveShareAccess(prisma, shareId, session, {
    pageId: childPageId,
    password: pw,
  })
  const hasAccess =
    resolved.kind === 'public' || resolved.kind === 'member' || resolved.kind === 'grant'
  const title = hasAccess ? resolved.page.title || 'Общий доступ' : 'Общий доступ'

  return {
    title,
    robots: { index, follow: index },
  }
}

// Deep link to a published subpage of a SITE share. The resolver validates that
// `childPageId` is genuinely inside the published subtree of `shareId` (the
// single authority — a fabricated/private/archived id resolves to
// `restricted_child`), so this route can never be used to bypass access.
export default async function ShareChildPage({
  params,
  searchParams,
}: {
  params: Promise<{ shareId: string; childPageId: string }>
  searchParams: Promise<{ pw?: string }>
}) {
  const { shareId, childPageId } = await params
  const { pw } = await searchParams
  const session = await getSession()
  const resolved = await resolveShareAccess(prisma, shareId, session, {
    pageId: childPageId,
    password: pw,
  })

  if (resolved.kind === 'not_found') notFound()

  if (resolved.kind === 'unavailable') {
    if (resolved.reason === 'password_required') {
      return <SharePasswordGate shareId={shareId} />
    }
    return <ShareUnavailable reason={resolved.reason} />
  }

  // Build the nav tree (rooted at the share root, not the requested child).
  const trpc = await getServerTRPC()
  const result = await trpc.page.share.publicTree({ shareId, password: pw })

  return (
    <SharePageView
      shareId={shareId}
      resolved={resolved}
      session={session}
      tree={{
        rootId: result.rootId,
        rootTitle: result.rootTitle,
        rootIcon: result.rootIcon,
        nodes: result.nodes,
      }}
      password={pw}
    />
  )
}
