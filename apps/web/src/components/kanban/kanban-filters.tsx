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
  Select,
  Stack,
  TextField,
  Typography,
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

// Compact filter menus: dense list + tight, small toggles so rows don't sprawl.
const DENSE_MENU_SLOT_PROPS = { list: { dense: true } } as const
const TOGGLE_SX = { py: 0.25, pr: 1, pl: 0.5 } as const
const MENU_ITEM_SX = { minHeight: 32 } as const

export function KanbanFiltersUI({ board, bag }: KanbanFiltersProps) {
  const [anchors, setAnchors] = useState<Record<string, HTMLElement | null>>({})
  const [showCompletedSprints, setShowCompletedSprints] = useState(false)

  const open = (key: string) => (e: MouseEvent<HTMLElement>) =>
    setAnchors((s) => ({ ...s, [key]: e.currentTarget }))
  const close = (key: string) => () => setAnchors((s) => ({ ...s, [key]: null }))

  const showSprintFilter = board.sprints.length > 0
  const guestParticipants = board.participants.filter((p) => !p.userId)
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
  const hasDateFilter = Boolean(
    bag.filters.dateFrom || bag.filters.dateTo || bag.filters.actualFrom || bag.filters.actualTo,
  )
  const sortLabelText =
    bag.filters.sortBy === 'manual'
      ? 'Сортировка'
      : `Сортировка: ${
          bag.filters.sortBy === 'planned'
            ? 'план'
            : bag.filters.sortBy === 'actual'
              ? 'факт'
              : 'отклонение'
        }`

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
            slotProps={DENSE_MENU_SLOT_PROPS}
          >
            <MenuItem sx={MENU_ITEM_SX} onClick={() => { bag.setSprintFilter('all'); close('sprint')() }}>
              <Radio size="small" sx={TOGGLE_SX} checked={bag.filters.sprint === 'all'} />
              <ListItemText primary="Все" />
            </MenuItem>
            <MenuItem sx={MENU_ITEM_SX} onClick={() => { bag.setSprintFilter('current'); close('sprint')() }}>
              <Radio size="small" sx={TOGGLE_SX} checked={bag.filters.sprint === 'current'} />
              <ListItemText primary="Текущий" />
            </MenuItem>
            {hasCompletedSprints ? <Divider /> : null}
            {hasCompletedSprints ? (
              <MenuItem sx={MENU_ITEM_SX} onClick={() => setShowCompletedSprints((value) => !value)}>
                <Checkbox size="small" sx={TOGGLE_SX} checked={showCompletedSprints} />
                <ListItemText primary="Показывать завершённые" />
              </MenuItem>
            ) : null}
            {sprintOptions.map((s) => {
              const arr = selectedSprintIds
              const checked = arr.includes(s.id)
              return (
                <MenuItem
                  key={s.id}
                  sx={MENU_ITEM_SX}
                  onClick={() => {
                    const next = checked ? arr.filter((x) => x !== s.id) : [...arr, s.id]
                    bag.setSprintFilter(next.length > 0 ? next : 'all')
                  }}
                >
                  <Checkbox size="small" sx={TOGGLE_SX} checked={checked} />
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
      <Menu
        anchorEl={anchors.users}
        open={Boolean(anchors.users)}
        onClose={close('users')}
        slotProps={DENSE_MENU_SLOT_PROPS}
      >
        {board.members.map((m) => {
          const checked = bag.filters.userIds.includes(m.user.id)
          return (
            <MenuItem
              key={m.user.id}
              sx={MENU_ITEM_SX}
              onClick={() => {
                const next = checked
                  ? bag.filters.userIds.filter((id) => id !== m.user.id)
                  : [...bag.filters.userIds, m.user.id]
                bag.setUserFilter(next)
              }}
            >
              <Checkbox size="small" sx={TOGGLE_SX} checked={checked} />
              <ListItemText primary={userLabel(m)} />
            </MenuItem>
          )
        })}
        {guestParticipants.length > 0 ? <Divider /> : null}
        {guestParticipants.map((p) => {
          const checked = bag.filters.userIds.includes(p.id)
          return (
            <MenuItem
              key={p.id}
              sx={MENU_ITEM_SX}
              onClick={() => {
                const next = checked
                  ? bag.filters.userIds.filter((id) => id !== p.id)
                  : [...bag.filters.userIds, p.id]
                bag.setUserFilter(next)
              }}
            >
              <Checkbox size="small" sx={TOGGLE_SX} checked={checked} />
              <ListItemText primary={p.fullName} secondary={p.company ?? undefined} />
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
            slotProps={DENSE_MENU_SLOT_PROPS}
          >
            {board.labels.map((l) => {
              const checked = bag.filters.labelIds.includes(l.id)
              return (
                <MenuItem
                  key={l.id}
                  sx={MENU_ITEM_SX}
                  onClick={() => {
                    const next = checked
                      ? bag.filters.labelIds.filter((id) => id !== l.id)
                      : [...bag.filters.labelIds, l.id]
                    bag.setLabelFilter(next)
                  }}
                >
                  <Checkbox size="small" sx={TOGGLE_SX} checked={checked} />
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

      <Chip
        label="Даты"
        variant={hasDateFilter ? 'filled' : 'outlined'}
        color={hasDateFilter ? 'primary' : 'default'}
        onClick={open('dates')}
        onDelete={
          hasDateFilter
            ? () => {
                bag.setDateFilter({ from: null, to: null, overdue: bag.filters.overdueOnly })
                bag.setActualDateFilter({ from: null, to: null })
              }
            : undefined
        }
      />
      <Menu
        anchorEl={anchors.dates}
        open={Boolean(anchors.dates)}
        onClose={close('dates')}
      >
        <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 220 }}>
          <Typography variant="caption" color="text.secondary">
            Плановая дата
          </Typography>
          <TextField
            type="date"
            size="small"
            label="с"
            slotProps={{ inputLabel: { shrink: true } }}
            value={bag.filters.dateFrom ?? ''}
            onChange={(e) =>
              bag.setDateFilter({
                from: e.target.value || null,
                to: bag.filters.dateTo,
                overdue: bag.filters.overdueOnly,
              })
            }
          />
          <TextField
            type="date"
            size="small"
            label="по"
            slotProps={{ inputLabel: { shrink: true } }}
            value={bag.filters.dateTo ?? ''}
            onChange={(e) =>
              bag.setDateFilter({
                from: bag.filters.dateFrom,
                to: e.target.value || null,
                overdue: bag.filters.overdueOnly,
              })
            }
          />
          <Typography variant="caption" color="text.secondary">
            Фактическая дата
          </Typography>
          <TextField
            type="date"
            size="small"
            label="с"
            slotProps={{ inputLabel: { shrink: true } }}
            value={bag.filters.actualFrom ?? ''}
            onChange={(e) =>
              bag.setActualDateFilter({ from: e.target.value || null, to: bag.filters.actualTo })
            }
          />
          <TextField
            type="date"
            size="small"
            label="по"
            slotProps={{ inputLabel: { shrink: true } }}
            value={bag.filters.actualTo ?? ''}
            onChange={(e) =>
              bag.setActualDateFilter({ from: bag.filters.actualFrom, to: e.target.value || null })
            }
          />
        </Box>
      </Menu>

      <Chip
        label={sortLabelText}
        variant={bag.filters.sortBy === 'manual' ? 'outlined' : 'filled'}
        color={bag.filters.sortBy === 'manual' ? 'default' : 'primary'}
        onClick={open('sort')}
        onDelete={
          bag.filters.sortBy === 'manual'
            ? undefined
            : () => bag.setSort({ sortBy: 'manual', sortDir: 'asc' })
        }
      />
      <Menu anchorEl={anchors.sort} open={Boolean(anchors.sort)} onClose={close('sort')}>
        <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 200 }}>
          <Select
            size="small"
            value={bag.filters.sortBy}
            onChange={(e) =>
              bag.setSort({
                sortBy: e.target.value as Filters['sortBy'],
                sortDir: bag.filters.sortDir,
              })
            }
          >
            <MenuItem value="manual">Вручную</MenuItem>
            <MenuItem value="planned">Плановая дата</MenuItem>
            <MenuItem value="actual">Фактическая дата</MenuItem>
            <MenuItem value="deviation">Отклонение</MenuItem>
          </Select>
          <Select
            size="small"
            value={bag.filters.sortDir}
            disabled={bag.filters.sortBy === 'manual'}
            onChange={(e) =>
              bag.setSort({
                sortBy: bag.filters.sortBy,
                sortDir: e.target.value as Filters['sortDir'],
              })
            }
          >
            <MenuItem value="asc">По возрастанию</MenuItem>
            <MenuItem value="desc">По убыванию</MenuItem>
          </Select>
        </Box>
      </Menu>
    </Stack>
  )
}

export type { Filters }
