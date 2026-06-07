'use client'

import { useRouter } from 'next/navigation'

import type { PageType } from '@repo/db'
import { ArrowBackIcon, Box, Button, Stack, Typography } from '@repo/ui/components'

import { PageView } from '@/components/page/page-view'

type Props = {
  workspaceId: string
  template: { title: string; icon: string | null }
  backingPage: { id: string; type: PageType; contentYjs: string | null }
  user: { id: string; name: string; color: string }
  editable: boolean
}

export function TemplateEditor({ workspaceId, template, backingPage, user, editable }: Props) {
  const router = useRouter()

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
          onClick={() => router.push(`/workspaces/${workspaceId}/marketplace`)}
        >
          К маркетплейсу
        </Button>
        <Box sx={{ fontSize: 20 }}>{template.icon ?? '📄'}</Box>
        <Typography variant="subtitle1" noWrap sx={{ flex: 1, minWidth: 0 }}>
          {template.title}
        </Typography>
      </Stack>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <PageView workspaceId={workspaceId} page={backingPage} user={user} editable={editable} />
      </Box>
    </Box>
  )
}
