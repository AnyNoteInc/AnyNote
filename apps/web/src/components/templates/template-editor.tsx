'use client'

import { useRouter } from 'next/navigation'

import type { PageType } from '@repo/db'
import { ArrowBackIcon, Box, Button, Stack, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'
import { PageView } from '@/components/page/page-view'

import { TemplateActionsMenu } from './template-actions-menu'

type Props = {
  workspaceId: string
  templateId: string
  template: { title: string; icon: string | null }
  description: string | null
  canEdit: boolean
  backingPageId: string | null
  backingPage: { id: string; type: PageType; contentYjs: string | null }
  user: { id: string; name: string; color: string }
  editable: boolean
}

export function TemplateEditor({
  workspaceId,
  templateId,
  template,
  description,
  canEdit,
  backingPageId,
  backingPage,
  user,
  editable,
}: Readonly<Props>) {
  const router = useRouter()

  const createPage = trpc.template.createPageFromTemplate.useMutation({
    onSuccess: (res) => router.push(`/pages/${res.id}`),
  })

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}
      >
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          onClick={() => router.push('/marketplace')}
        >
          К маркетплейсу
        </Button>
        <Box sx={{ fontSize: 20 }}>{template.icon ?? '📄'}</Box>
        <Typography variant="subtitle1" noWrap sx={{ minWidth: 0 }}>
          {template.title}
        </Typography>
        <Box sx={{ flex: 1 }} />
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
          title={template.title}
          icon={template.icon}
          description={description}
        />
      </Stack>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <PageView workspaceId={workspaceId} page={backingPage} user={user} editable={editable} />
      </Box>
    </Box>
  )
}
