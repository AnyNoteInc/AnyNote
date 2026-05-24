'use client'

import type { PageType } from '@repo/db'

import { PageRenderer } from '@/components/page/page-renderer'

type EffectiveRole = 'OWNER' | 'EDITOR' | 'COMMENTER' | 'READER'

type Props = {
  shareId: string
  page: { id: string; type: PageType; contentYjs: string | null }
  workspaceId: string
  user: { id: string; name: string; color: string }
  editable: boolean
  role: EffectiveRole
}

export function SharePageClient({ shareId, page, workspaceId, user, editable, role }: Props) {
  const yjsToken = async () => {
    const res = await fetch('/api/yjs/share-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shareId }),
    })
    if (!res.ok) throw new Error(`share token failed: ${res.status}`)
    const data = (await res.json()) as { token: string }
    return data.token
  }

  return (
    <PageRenderer
      page={page}
      workspaceId={workspaceId}
      user={user}
      yjsToken={yjsToken}
      editable={editable}
      commentTarget={{ shareId }}
      canComment={role !== 'READER'}
    />
  )
}
