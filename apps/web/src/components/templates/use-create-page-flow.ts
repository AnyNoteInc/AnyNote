'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'

import { trpc } from '@/trpc/client'

import type { CreatablePageType } from './page-type-registry'

/**
 * Shared logic for the "create page" entry points (the Страницы header and each
 * page row's `+`). Owns the dialog open state, both create mutations, tree
 * invalidation, and navigation, so call sites only pass the target parentId.
 */
export function useCreatePageFlow(workspaceId: string) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const [open, setOpen] = useState(false)
  const [parentId, setParentId] = useState<string | null>(null)

  const onCreated = useCallback(
    async (data: { id: string }) => {
      await utils.page.listByWorkspace.invalidate({ workspaceId })
      setOpen(false)
      router.push(`/workspaces/${workspaceId}/pages/${data.id}`)
    },
    [router, utils, workspaceId],
  )

  const createPage = trpc.page.create.useMutation({ onSuccess: onCreated })
  const createFromTemplate = trpc.template.createPageFromTemplate.useMutation({
    onSuccess: onCreated,
  })

  const openFor = useCallback((nextParentId: string | null) => {
    setParentId(nextParentId)
    setOpen(true)
  }, [])

  const close = useCallback(() => setOpen(false), [])

  const handleCreatePage = useCallback(
    (type: CreatablePageType) => {
      createPage.mutate({ workspaceId, parentId, type })
    },
    [createPage, workspaceId, parentId],
  )

  const handleCreateFromTemplate = useCallback(
    (templateId: string) => {
      createFromTemplate.mutate({ templateId, workspaceId, parentId })
    },
    [createFromTemplate, workspaceId, parentId],
  )

  return {
    open,
    openFor,
    close,
    handleCreatePage,
    handleCreateFromTemplate,
    isCreating: createPage.isPending || createFromTemplate.isPending,
  }
}
