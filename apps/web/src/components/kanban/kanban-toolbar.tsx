'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AddIcon, Box, Button, Stack, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import type { useKanbanFilters } from './use-kanban-filters'
import { ViewSwitcher } from './view-switcher'

type FiltersBag = ReturnType<typeof useKanbanFilters>

interface KanbanToolbarProps {
  readonly pageId: string
  readonly filtersBag: FiltersBag
}

export function KanbanToolbar({ pageId, filtersBag }: KanbanToolbarProps) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const createTask = trpc.kanban.task.create.useMutation({
    onSuccess: async (task: { id: string }) => {
      await utils.kanban.board.getBoard.invalidate({ pageId })
      const params = new URLSearchParams(globalThis.location.search)
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
      spacing={2}
      sx={{ px: 3, py: 1.5, borderBottom: 1, borderColor: 'divider' }}
    >
      <Stack direction="row" alignItems="center" spacing={2}>
        <Box>
          <Typography variant="h6">Канбан</Typography>
        </Box>
        <ViewSwitcher view={filtersBag.view} onChange={filtersBag.setView} />
      </Stack>
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
