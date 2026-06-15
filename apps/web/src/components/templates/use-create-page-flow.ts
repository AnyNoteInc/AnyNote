'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'

import { trpc } from '@/trpc/client'
import { usePlanFeaturesOptional } from '@/components/workspace/plan-features-context'

import type { CreatablePageType } from './page-type-registry'

/**
 * Shared logic for the "create page" entry points (the Страницы header and each
 * page row's `+`). Owns the dialog open state, the create mutations (blank page,
 * from-template, and the special DASHBOARD create), the meeting-upload dialog
 * state, tree invalidation, and navigation, so call sites only pass the target
 * parentId.
 */
type CreateLocation = 'team' | 'private'

export function useCreatePageFlow(workspaceId: string) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const [open, setOpen] = useState(false)
  const [parentId, setParentId] = useState<string | null>(null)
  const [location, setLocation] = useState<CreateLocation | undefined>(undefined)
  const [meetingOpen, setMeetingOpen] = useState(false)

  // The «Загрузить встречу» tile is gated on the plan flag (the meeting create
  // mutation also 403s server-side). Optional read: the create flow only mounts
  // inside the protected app where the provider exists, but stay null-safe.
  const meetingsEnabled = usePlanFeaturesOptional()?.meetingsEnabled ?? false

  const onCreated = useCallback(
    async (data: { id: string }) => {
      await utils.page.listByWorkspace.invalidate({ workspaceId })
      setOpen(false)
      router.push(`/pages/${data.id}`)
    },
    [router, utils, workspaceId],
  )

  const createPage = trpc.page.create.useMutation({ onSuccess: onCreated })
  const createFromTemplate = trpc.template.createPageFromTemplate.useMutation({
    onSuccess: onCreated,
  })
  // DASHBOARD pages run their own create (page + Dashboard row) and return a
  // pageId, so they get a dedicated mutation rather than the generic page.create.
  const createDashboard = trpc.dashboard.create.useMutation({
    onSuccess: async (result) => {
      await utils.page.listByWorkspace.invalidate({ workspaceId })
      setOpen(false)
      router.push(`/pages/${result.pageId}`)
    },
  })

  const openFor = useCallback(
    (nextParentId: string | null, opts?: { location?: CreateLocation }) => {
      setParentId(nextParentId)
      // Nested pages inherit their parent's collection (the domain infers from
      // parentId when location is absent), so only apply a location at the root.
      // A root-level quick-create with no explicit location defaults to Private,
      // matching Notion's behavior.
      if (nextParentId !== null) {
        setLocation(undefined)
      } else {
        setLocation(opts?.location ?? 'private')
      }
      setOpen(true)
    },
    [],
  )

  const close = useCallback(() => setOpen(false), [])

  const handleCreatePage = useCallback(
    (type: CreatablePageType) => {
      createPage.mutate({ workspaceId, parentId, type, location })
    },
    [createPage, workspaceId, parentId, location],
  )

  const handleCreateFromTemplate = useCallback(
    (templateId: string) => {
      createFromTemplate.mutate({ templateId, workspaceId, parentId })
    },
    [createFromTemplate, workspaceId, parentId],
  )

  // DASHBOARD pages are always team-scoped roots (the create mutation hardcodes
  // location: 'team'); ignore parentId/location from the create flow.
  const handleCreateDashboard = useCallback(() => {
    createDashboard.mutate({ workspaceId })
  }, [createDashboard, workspaceId])

  // Selecting «Загрузить встречу» swaps the create dialog for the upload dialog.
  const openMeetingUpload = useCallback(() => {
    setOpen(false)
    setMeetingOpen(true)
  }, [])

  const closeMeetingUpload = useCallback(() => setMeetingOpen(false), [])

  return {
    open,
    openFor,
    close,
    handleCreatePage,
    handleCreateFromTemplate,
    handleCreateDashboard,
    meetingsEnabled,
    meetingOpen,
    openMeetingUpload,
    closeMeetingUpload,
    isCreating: createPage.isPending || createFromTemplate.isPending || createDashboard.isPending,
  }
}
