'use client'

import { useCallback } from 'react'

import { filterMentionItems } from '@repo/editor'

import { trpc } from '@/trpc/client'

/** Workspace member @mention search, shared by the editor and the comment composer. */
export function useWorkspaceMentionSearch(workspaceId: string) {
  const trpcUtils = trpc.useUtils()
  return useCallback(
    async (query: string) => {
      try {
        const members = await trpcUtils.workspace.listMembers.ensureData({ workspaceId })
        return filterMentionItems(
          members.map((member) => {
            const name =
              [member.user.firstName, member.user.lastName].filter(Boolean).join(' ').trim() ||
              member.user.email
            return { id: member.user.id, name, email: member.user.email }
          }),
          query,
        )
      } catch {
        return []
      }
    },
    [trpcUtils, workspaceId],
  )
}
