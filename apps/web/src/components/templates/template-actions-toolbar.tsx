'use client'

import { useRouter } from 'next/navigation'

import { Button, Stack } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { TemplateActionsMenu } from './template-actions-menu'

type Props = {
  templateId: string
  workspaceId: string
  canEdit: boolean
  backingPageId: string | null
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
  backingPageId,
  title,
  icon,
  description,
}: Readonly<Props>) {
  const router = useRouter()

  const createPage = trpc.template.createPageFromTemplate.useMutation({
    onSuccess: (res) => router.push(`/pages/${res.id}`),
  })

  return (
    <Stack direction="row" alignItems="center" spacing={1}>
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
        backingPageId={backingPageId}
        canEdit={canEdit}
        title={title}
        icon={icon}
        description={description}
      />
    </Stack>
  )
}
