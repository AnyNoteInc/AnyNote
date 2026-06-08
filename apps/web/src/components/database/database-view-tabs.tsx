'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AddIcon,
  Box,
  Button,
  CalendarMonthIcon,
  ContentCopyIcon,
  DeleteIcon,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  EditIcon,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  MoreVertIcon,
  Stack,
  Tab,
  TableChartIcon,
  Tabs,
  TextField,
  ViewKanbanIcon,
  ViewListIcon,
} from '@repo/ui/components'
import type { DatabaseViewType } from '@repo/db'

import { trpc } from '@/trpc/client'

import type { DatabaseSchema, DatabaseViewEntry } from './types'

interface DatabaseViewTabsProps {
  readonly pageId: string
  readonly views: DatabaseSchema['views']
  readonly activeViewId: string
  readonly editable?: boolean
}

const VIEW_TYPE_ICON: Record<DatabaseViewType, React.ReactNode> = {
  TABLE: <TableChartIcon fontSize="small" />,
  BOARD: <ViewKanbanIcon fontSize="small" />,
  CALENDAR: <CalendarMonthIcon fontSize="small" />,
  LIST: <ViewListIcon fontSize="small" />,
}

const ADD_VIEW_TYPES: ReadonlyArray<{ type: DatabaseViewType; label: string }> = [
  { type: 'TABLE', label: 'Таблица' },
  { type: 'BOARD', label: 'Доска' },
  { type: 'CALENDAR', label: 'Календарь' },
  { type: 'LIST', label: 'Список' },
]

const DEFAULT_VIEW_TITLE: Record<DatabaseViewType, string> = {
  TABLE: 'Таблица',
  BOARD: 'Доска',
  CALENDAR: 'Календарь',
  LIST: 'Список',
}

/**
 * The view tab strip. Tabs come from `data.views` (sorted by position); the active
 * tab is `?viewId=` (fallback `views[0]`). An add-view menu creates TABLE/BOARD/
 * CALENDAR/LIST views (`createView`, settings auto-seeded by the domain); a per-tab
 * menu renames (`updateView`), deletes (`deleteView`, disabled on the last view),
 * and duplicates (`duplicateView`). Selecting a tab writes `?viewId=` via
 * `router.replace` (preserving any other params, e.g. a transiently open `?rowId=`).
 */
export function DatabaseViewTabs({
  pageId,
  views,
  activeViewId,
  editable = true,
}: DatabaseViewTabsProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const utils = trpc.useUtils()

  const sorted = useMemo(
    () => [...views].sort((a, b) => a.position - b.position),
    [views],
  )

  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null)
  const [menuView, setMenuView] = useState<DatabaseViewEntry | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [renameView, setRenameView] = useState<DatabaseViewEntry | null>(null)
  const [draftTitle, setDraftTitle] = useState('')

  const afterMutation = () => utils.database.getByPage.invalidate({ pageId })

  const createView = trpc.database.createView.useMutation({
    onSuccess: async (created) => {
      await afterMutation()
      selectView(created.id)
    },
  })
  const updateView = trpc.database.updateView.useMutation({ onSuccess: afterMutation })
  const duplicateView = trpc.database.duplicateView.useMutation({
    onSuccess: async (created) => {
      await afterMutation()
      selectView(created.id)
    },
  })
  const deleteView = trpc.database.deleteView.useMutation({
    onSuccess: async () => {
      await afterMutation()
      // If we deleted the active view, fall back to the first remaining one.
      const fallback = sorted.find((v) => v.id !== menuView?.id)
      if (menuView?.id === activeViewId && fallback) selectView(fallback.id)
    },
  })

  function selectView(viewId: string) {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set('viewId', viewId)
    router.replace(`?${params.toString()}`)
  }

  function addView(type: DatabaseViewType) {
    setAddAnchor(null)
    createView.mutate({ pageId, type, title: DEFAULT_VIEW_TITLE[type] })
  }

  function openTabMenu(view: DatabaseViewEntry, anchor: HTMLElement) {
    setMenuView(view)
    setMenuAnchor(anchor)
  }

  function openRename() {
    if (menuView) {
      setRenameView(menuView)
      setDraftTitle(menuView.title)
    }
    setMenuAnchor(null)
  }

  function submitRename() {
    const next = draftTitle.trim()
    if (renameView && next && next !== renameView.title) {
      updateView.mutate({ pageId, id: renameView.id, title: next })
    }
    setRenameView(null)
  }

  // Tabs value must always match a known tab; if `activeViewId` is stale, anchor
  // the underline on the first tab to avoid an out-of-range warning.
  const tabsValue = sorted.some((v) => v.id === activeViewId) ? activeViewId : (sorted[0]?.id ?? false)

  return (
    <Stack
      direction="row"
      alignItems="center"
      sx={{ px: 1, borderBottom: 1, borderColor: 'divider', minHeight: 40 }}
    >
      <Tabs
        value={tabsValue}
        onChange={(_, value: string) => selectView(value)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ minHeight: 40, '& .MuiTab-root': { minHeight: 40, py: 0, textTransform: 'none' } }}
      >
        {sorted.map((view) => (
          <Tab
            key={view.id}
            value={view.id}
            icon={VIEW_TYPE_ICON[view.type] as React.ReactElement}
            iconPosition="start"
            label={
              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
                {view.title}
                {editable ? (
                  <IconButton
                    component="span"
                    size="small"
                    aria-label="Действия с представлением"
                    sx={{ ml: 0.25, p: 0.25 }}
                    onClick={(e) => {
                      e.stopPropagation()
                      openTabMenu(view, e.currentTarget)
                    }}
                  >
                    <MoreVertIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                ) : null}
              </Box>
            }
          />
        ))}
      </Tabs>

      {editable ? (
        <IconButton
          size="small"
          aria-label="Добавить представление"
          onClick={(e) => setAddAnchor(e.currentTarget)}
          sx={{ ml: 0.5 }}
        >
          <AddIcon fontSize="small" />
        </IconButton>
      ) : null}

      <Menu anchorEl={addAnchor} open={Boolean(addAnchor)} onClose={() => setAddAnchor(null)}>
        {ADD_VIEW_TYPES.map((entry) => (
          <MenuItem key={entry.type} onClick={() => addView(entry.type)}>
            <ListItemIcon>{VIEW_TYPE_ICON[entry.type]}</ListItemIcon>
            <ListItemText primary={entry.label} />
          </MenuItem>
        ))}
      </Menu>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem onClick={openRename}>
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Переименовать" />
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuView) duplicateView.mutate({ pageId, viewId: menuView.id })
            setMenuAnchor(null)
          }}
        >
          <ListItemIcon>
            <ContentCopyIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Дублировать" />
        </MenuItem>
        <MenuItem
          disabled={sorted.length <= 1}
          onClick={() => {
            if (menuView) deleteView.mutate({ pageId, id: menuView.id })
            setMenuAnchor(null)
          }}
        >
          <ListItemIcon>
            <DeleteIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Удалить" />
        </MenuItem>
      </Menu>

      <Dialog open={Boolean(renameView)} onClose={() => setRenameView(null)}>
        <DialogTitle>Переименовать представление</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitRename()
            }}
            sx={{ mt: 1, minWidth: 280 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameView(null)}>Отмена</Button>
          <Button variant="contained" onClick={submitRename} disabled={updateView.isPending}>
            Сохранить
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
