'use client'

import { useState, type MouseEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  AddIcon,
  Button,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  SettingsIcon,
  Stack,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import type { BoardData } from './types'
import type { useKanbanFilters } from './use-kanban-filters'
import { KanbanSettingsDialog } from './settings/kanban-settings-dialog'
import { ViewSwitcher } from './view-switcher'

type FiltersBag = ReturnType<typeof useKanbanFilters>

interface KanbanToolbarProps {
  readonly pageId: string
  readonly filtersBag: FiltersBag
  readonly board: BoardData
}

export function KanbanToolbar({ pageId, filtersBag, board }: KanbanToolbarProps) {
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
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  function openMenu(e: MouseEvent<HTMLElement>) {
    setMenuAnchor(e.currentTarget)
  }
  function closeMenu() {
    setMenuAnchor(null)
  }

  return (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="space-between"
      spacing={2}
      sx={{ px: 4, py: 1, borderBottom: 1, borderColor: 'divider' }}
    >
      <ViewSwitcher view={filtersBag.view} onChange={filtersBag.setView} />
      <Stack direction="row" spacing={1} alignItems="center">
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
        <IconButton onClick={openMenu} size="small" aria-label="Настройки канбана">
          <SettingsIcon />
        </IconButton>
        <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
          <MenuItem
            onClick={() => {
              closeMenu()
              setSettingsOpen(true)
            }}
          >
            <ListItemText primary="Настройки канбана" />
          </MenuItem>
        </Menu>
      </Stack>
      <KanbanSettingsDialog
        pageId={pageId}
        board={board}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </Stack>
  )
}
