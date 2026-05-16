'use client'

import { useState } from 'react'
import {
  AddIcon,
  DeleteIcon,
  Divider,
  EditIcon,
  FlagIcon,
  IconButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  MoreVertIcon,
  PlayArrowIcon,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import type { BoardColumnRow, BoardData, BoardTaskData } from '../types'
import { SprintCompleteDialog } from './sprint-complete-dialog'
import { SprintDeleteDialog } from './sprint-delete-dialog'
import { SprintEditDialog } from './sprint-edit-dialog'
import type { SprintLike } from './types'

interface SprintMenuProps {
  readonly pageId: string
  readonly sprint: SprintLike
  readonly allSprints: BoardData['sprints']
  readonly columns: BoardColumnRow[]
  readonly tasks: BoardTaskData[]
  readonly onCreateTask?: () => void
}

type OpenDialog = 'edit' | 'complete' | 'delete' | null

export function SprintMenu({
  pageId,
  sprint,
  allSprints,
  columns,
  tasks,
  onCreateTask,
}: SprintMenuProps) {
  const utils = trpc.useUtils()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const [dialog, setDialog] = useState<OpenDialog>(null)

  const activate = trpc.kanban.sprint.activate.useMutation({
    onSuccess: () => utils.kanban.board.getBoard.invalidate({ pageId }),
  })

  function close() {
    setAnchorEl(null)
  }

  function handleStart() {
    close()
    activate.mutate({ pageId, id: sprint.id })
  }

  function handleCreateTask() {
    close()
    onCreateTask?.()
  }

  function openDialog(d: Exclude<OpenDialog, null>) {
    close()
    setDialog(d)
  }

  return (
    <>
      <IconButton
        aria-label="Действия со спринтом"
        size="small"
        onClick={(e) => setAnchorEl(e.currentTarget)}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={close}
        disableRestoreFocus
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { minWidth: 220 } } }}
      >
        <ListSubheader sx={{ lineHeight: '32px', bgcolor: 'transparent' }}>
          Действия со спринтом
        </ListSubheader>

        {onCreateTask ? (
          <MenuItem onClick={handleCreateTask}>
            <ListItemIcon>
              <AddIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Создать задачу</ListItemText>
          </MenuItem>
        ) : null}

        {sprint.status === 'PLANNED' ? (
          <MenuItem onClick={handleStart} disabled={activate.isPending}>
            <ListItemIcon>
              <PlayArrowIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Стартовать спринт</ListItemText>
          </MenuItem>
        ) : null}

        {sprint.status === 'ACTIVE' ? (
          <MenuItem onClick={() => openDialog('complete')}>
            <ListItemIcon>
              <FlagIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Завершить спринт</ListItemText>
          </MenuItem>
        ) : null}

        <MenuItem onClick={() => openDialog('edit')}>
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Изменить спринт</ListItemText>
        </MenuItem>

        <Divider />

        <MenuItem onClick={() => openDialog('delete')} sx={{ color: 'error.main' }}>
          <ListItemIcon sx={{ color: 'error.main' }}>
            <DeleteIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Удалить спринт</ListItemText>
        </MenuItem>
      </Menu>

      {dialog === 'edit' ? (
        <SprintEditDialog
          pageId={pageId}
          sprint={sprint}
          open
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog === 'complete' ? (
        <SprintCompleteDialog
          pageId={pageId}
          sprint={sprint}
          tasks={tasks}
          columns={columns}
          otherSprints={allSprints}
          open
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog === 'delete' ? (
        <SprintDeleteDialog
          pageId={pageId}
          sprint={sprint}
          tasks={tasks}
          open
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  )
}
