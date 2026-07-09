'use client'

import { useRouter } from 'next/navigation'

import { Button, Stack } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { TemplateActionsMenu } from './template-actions-menu'

type Props = {
  templateId: string
  workspaceId: string
  canEdit: boolean
  title: string
  icon: string | null
  description: string | null
}

/**
 * Right-side toolbar for the template view: the "Использовать" action (creates
 * a page from the template) plus the three-dots actions menu. Rendered in the
 * WorkspaceToolbar rightSlot so the template view needs no second header row.
 */
export function TemplateActionsToolbar({
  templateId,
  workspaceId,
  canEdit,
  title,
  icon,
  description,
}: Readonly<Props>) {
  const router = useRouter()
  const utils = trpc.useUtils()

  const createPage = trpc.template.createPageFromTemplate.useMutation({
    onSuccess: async (res) => {
      // Refresh the sidebar page tree (and favorites) so the new page shows up
      // immediately, then navigate to it.
      await Promise.all([
        utils.page.listByWorkspace.invalidate({ workspaceId }),
        utils.page.listFavorites.invalidate({ workspaceId }),
      ])
      router.push(`/pages/${res.id}`)
    },
  })

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Button
        variant="contained"
        size="small"
        disabled={createPage.isPending}
        onClick={() => createPage.mutate({ templateId, workspaceId, parentId: null })}
      >
        Использовать
      </Button>
      <TemplateActionsMenu
        templateId={templateId}
        workspaceId={workspaceId}
        canEdit={canEdit}
        title={title}
        icon={icon}
        description={description}
      />
    </Stack>
  )
}
