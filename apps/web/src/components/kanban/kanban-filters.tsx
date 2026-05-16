'use client'

import { useState, type MouseEvent } from 'react'
import {
  Box,
  Checkbox,
  Chip,
  Divider,
  ListItemText,
  Menu,
  MenuItem,
  Radio,
  Stack,
} from '@repo/ui/components'

import type { BoardData } from './types'
import type { KanbanFilters as Filters } from './filters/apply-filters'
import { sprintStatusLabel } from './sprint/sprint-status-label'
import { visibleSprintFilterOptions } from './sprint-filter-options'
import type { useKanbanFilters } from './use-kanban-filters'

type FiltersBag = ReturnType<typeof useKanbanFilters>

interface KanbanFiltersProps {
  board: BoardData
  bag: FiltersBag
}

function userLabel(m: BoardData['members'][number]) {
  return `${m.user.firstName ?? ''} ${m.user.lastName ?? ''}`.trim() || m.user.email
}

export function KanbanFiltersUI({ board, bag }: KanbanFiltersProps) {
  const [anchors, setAnchors] = useState<Record<string, HTMLElement | null>>({})
  const [showCompletedSprints, setShowCompletedSprints] = useState(false)

  const open = (key: string) => (e: MouseEvent<HTMLElement>) =>
    setAnchors((s) => ({ ...s, [key]: e.currentTarget }))
  const close = (key: string) => () => setAnchors((s) => ({ ...s, [key]: null }))

  const showSprintFilter = board.sprints.length > 0
  const selectedSprintIds = Array.isArray(bag.filters.sprint) ? bag.filters.sprint : []
  const hasCompletedSprints = board.sprints.some((s) => s.status === 'COMPLETED')
  const sprintOptions = visibleSprintFilterOptions(
    board.sprints,
    showCompletedSprints,
    selectedSprintIds,
  )

  const sprintLabel = (() => {
    const value = bag.filters.sprint
    if (value === 'all') return 'Спринт: все'
    if (value === 'current') return 'Спринт: текущий'
    return `Спринт: ${value.length}`
  })()

  const userLabelText =
    bag.filters.userIds.length === 0
      ? 'Пользователи'
      : `Пользователи (${bag.filters.userIds.length})`
  const labelLabelText =
    bag.filters.labelIds.length === 0 ? 'Метки' : `Метки (${bag.filters.labelIds.length})`

  return (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
      {showSprintFilter ? (
        <>
          <Chip
            label={sprintLabel}
            variant={bag.filters.sprint === 'all' ? 'outlined' : 'filled'}
            color={bag.filters.sprint === 'all' ? 'default' : 'primary'}
            onClick={open('sprint')}
          />
          <Menu
            anchorEl={anchors.sprint}
            open={Boolean(anchors.sprint)}
            onClose={close('sprint')}
          >
            <MenuItem onClick={() => { bag.setSprintFilter('all'); close('sprint')() }}>
              <Radio checked={bag.filters.sprint === 'all'} />
              <ListItemText primary="Все" />
            </MenuItem>
            <MenuItem onClick={() => { bag.setSprintFilter('current'); close('sprint')() }}>
              <Radio checked={bag.filters.sprint === 'current'} />
              <ListItemText primary="Текущий" />
            </MenuItem>
            {hasCompletedSprints ? <Divider /> : null}
            {hasCompletedSprints ? (
              <MenuItem onClick={() => setShowCompletedSprints((value) => !value)}>
                <Checkbox checked={showCompletedSprints} />
                <ListItemText primary="Показывать завершённые" />
              </MenuItem>
            ) : null}
            {sprintOptions.map((s) => {
              const arr = selectedSprintIds
              const checked = arr.includes(s.id)
              return (
                <MenuItem
                  key={s.id}
                  onClick={() => {
                    const next = checked ? arr.filter((x) => x !== s.id) : [...arr, s.id]
                    bag.setSprintFilter(next.length > 0 ? next : 'all')
                  }}
                >
                  <Checkbox checked={checked} />
                  <ListItemText primary={s.name} secondary={sprintStatusLabel(s.status)} />
                </MenuItem>
              )
            })}
          </Menu>
        </>
      ) : null}

      <Chip
        label={userLabelText}
        variant={bag.filters.userIds.length === 0 ? 'outlined' : 'filled'}
        color={bag.filters.userIds.length === 0 ? 'default' : 'primary'}
        onClick={open('users')}
        onDelete={bag.filters.userIds.length === 0 ? undefined : () => bag.setUserFilter([])}
      />
      <Menu anchorEl={anchors.users} open={Boolean(anchors.users)} onClose={close('users')}>
        {board.members.map((m) => {
          const checked = bag.filters.userIds.includes(m.user.id)
          return (
            <MenuItem
              key={m.user.id}
              onClick={() => {
                const next = checked
                  ? bag.filters.userIds.filter((id) => id !== m.user.id)
                  : [...bag.filters.userIds, m.user.id]
                bag.setUserFilter(next)
              }}
            >
              <Checkbox checked={checked} />
              <ListItemText primary={userLabel(m)} />
            </MenuItem>
          )
        })}
      </Menu>

      {board.labels.length > 0 ? (
        <>
          <Chip
            label={labelLabelText}
            variant={bag.filters.labelIds.length === 0 ? 'outlined' : 'filled'}
            color={bag.filters.labelIds.length === 0 ? 'default' : 'primary'}
            onClick={open('labels')}
            onDelete={bag.filters.labelIds.length === 0 ? undefined : () => bag.setLabelFilter([])}
          />
          <Menu
            anchorEl={anchors.labels}
            open={Boolean(anchors.labels)}
            onClose={close('labels')}
          >
            {board.labels.map((l) => {
              const checked = bag.filters.labelIds.includes(l.id)
              return (
                <MenuItem
                  key={l.id}
                  onClick={() => {
                    const next = checked
                      ? bag.filters.labelIds.filter((id) => id !== l.id)
                      : [...bag.filters.labelIds, l.id]
                    bag.setLabelFilter(next)
                  }}
                >
                  <Checkbox checked={checked} />
                  <Box
                    sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: l.color, mr: 1 }}
                  />
                  <ListItemText primary={l.name} />
                </MenuItem>
              )
            })}
          </Menu>
        </>
      ) : null}
    </Stack>
  )
}

export type { Filters }
