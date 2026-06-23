'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

/**
 * Sets the Sentry user/workspace tags on the BROWSER scope. Rendered by the
 * (protected) layout with ids already resolved server-side, so no client fetch.
 */
export function SentryIdentity({
  userId,
  workspaceId,
}: {
  userId: string
  workspaceId: string | null
}) {
  useEffect(() => {
    Sentry.setUser({ id: userId })
    if (workspaceId) Sentry.setTag('workspaceId', workspaceId)
    return () => {
      Sentry.setUser(null)
    }
  }, [userId, workspaceId])

  return null
}
