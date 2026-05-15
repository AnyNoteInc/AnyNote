'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AddIcon, Box, Button, Stack, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

interface KanbanToolbarProps {
  pageId: string
  workspaceId: string
}

export function KanbanToolbar({ pageId }: KanbanToolbarProps) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const createTask = trpc.kanban.task.create.useMutation({
    onSuccess: async (task: { id: string }) => {
      await utils.kanban.board.getBoard.invalidate({ pageId })
      const params = new URLSearchParams(window.location.search)
      params.set('taskId', task.id)
      router.replace(`?${params.toString()}`)
    },
  })
  const [busy, setBusy] = useState(false)

  return (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="space-between"
      sx={{ px: 3, py: 1.5, borderBottom: 1, borderColor: 'divider' }}
    >
      <Box>
        <Typography variant="h6">Канбан</Typography>
      </Box>
      <Button
        variant="contained"
        startIcon={<AddIcon />}
        disabled={busy || createTask.isPending}
        onClick={async () => {
          setBusy(true)
          try {
            await createTask.mutateAsync({ pageId, title: 'Новая задача' })
          } finally {
            setBusy(false)
          }
        }}
      >
        Создать задачу
      </Button>
    </Stack>
  )
}
