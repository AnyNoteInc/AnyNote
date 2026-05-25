'use client'

import { useEffect } from 'react'

import { parseCommentHash } from './comment-hash'

/**
 * On mount and on `hashchange`, route a `#comment-<id>` URL hash to the given
 * opener (used to force-open the sidebar on a deep-linked thread).
 */
export function useCommentHash(onTarget: (threadId: string) => void) {
  useEffect(() => {
    const apply = () => {
      const id = parseCommentHash(window.location.hash)
      if (id) onTarget(id)
    }
    apply()
    window.addEventListener('hashchange', apply)
    return () => window.removeEventListener('hashchange', apply)
  }, [onTarget])
}
