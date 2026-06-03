'use client'

import { useState } from 'react'
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Tab,
  Tabs,
  CloseIcon,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { KANBAN_LABEL_COLORS } from '@repo/domain/kanban/colors.ts'

import { SortableList, type SortableItem } from './sortable-list'
import { ParticipantsTab } from './participants-tab'
import type { BoardData } from '../types'

interface KanbanSettingsDialogProps {
  readonly pageId: string
  readonly board: BoardData
  readonly open: boolean
  readonly onClose: () => void
}

type TabKey = 'types' | 'priorities' | 'labels' | 'statuses' | 'participants'

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'types', label: 'Типы' },
  { key: 'priorities', label: 'Приоритеты' },
  { key: 'labels', label: 'Метки' },
  { key: 'statuses', label: 'Статусы' },
  { key: 'participants', label: 'Участники' },
]

export function KanbanSettingsDialog({
  pageId,
  board,
  open,
  onClose,
}: KanbanSettingsDialogProps) {
  const [tab, setTab] = useState<TabKey>('types')
  const utils = trpc.useUtils()
  const invalidate = () => utils.kanban.board.getBoard.invalidate({ pageId })

  // type
  const createType = trpc.kanban.type.create.useMutation({ onSuccess: invalidate })
  const updateType = trpc.kanban.type.update.useMutation({ onSuccess: invalidate })
  const reorderType = trpc.kanban.type.reorder.useMutation({ onSuccess: invalidate })
  const deleteType = trpc.kanban.type.delete.useMutation({ onSuccess: invalidate })

  // priority
  const createPriority = trpc.kanban.priority.create.useMutation({ onSuccess: invalidate })
  const updatePriority = trpc.kanban.priority.update.useMutation({ onSuccess: invalidate })
  const reorderPriority = trpc.kanban.priority.reorder.useMutation({ onSuccess: invalidate })
  const deletePriority = trpc.kanban.priority.delete.useMutation({ onSuccess: invalidate })

  // label
  const createLabel = trpc.kanban.label.create.useMutation({ onSuccess: invalidate })
  const updateLabel = trpc.kanban.label.update.useMutation({ onSuccess: invalidate })
  const reorderLabel = trpc.kanban.label.reorder.useMutation({ onSuccess: invalidate })
  const deleteLabel = trpc.kanban.label.delete.useMutation({ onSuccess: invalidate })

  // column / status
  const createColumn = trpc.kanban.column.create.useMutation({ onSuccess: invalidate })
  const updateColumn = trpc.kanban.column.update.useMutation({ onSuccess: invalidate })
  const reorderColumn = trpc.kanban.column.reorder.useMutation({ onSuccess: invalidate })
  const deleteColumn = trpc.kanban.column.delete.useMutation({ onSuccess: invalidate })

  function asItems(rows: Array<{ id: string; title: string; position: number; color?: string | null }>): SortableItem[] {
    return rows.map((r) => ({ id: r.id, title: r.title, position: r.position, color: r.color ?? null }))
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        Настройки канбана
        <IconButton onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Tabs
          value={tab}
          onChange={(_, v: TabKey) => setTab(v)}
          sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
        >
          {TABS.map((t) => (
            <Tab key={t.key} value={t.key} label={t.label} />
          ))}
        </Tabs>

        {tab === 'types' ? (
          <SortableList
            items={asItems(board.types)}
            addPlaceholder="Новый тип"
            onAdd={(title) => createType.mutateAsync({ pageId, title })}
            onRename={(id, title) => updateType.mutateAsync({ pageId, id, title })}
            onReorder={(id, beforeId, afterId) =>
              reorderType.mutateAsync({ pageId, id, beforeId, afterId })
            }
            onDelete={(id) => deleteType.mutateAsync({ pageId, id })}
          />
        ) : null}

        {tab === 'priorities' ? (
          <SortableList
            items={asItems(board.priorities)}
            addPlaceholder="Новый приоритет"
            onAdd={(title) =>
              createPriority.mutateAsync({
                pageId,
                title,
                color: KANBAN_LABEL_COLORS[0]!.hex,
              })
            }
            onRename={(id, title) => updatePriority.mutateAsync({ pageId, id, title })}
            onReorder={(id, beforeId, afterId) =>
              reorderPriority.mutateAsync({ pageId, id, beforeId, afterId })
            }
            onDelete={(id) => deletePriority.mutateAsync({ pageId, id })}
            extraColumn={(item) => (
              <Select
                size="small"
                value={item.color ?? KANBAN_LABEL_COLORS[0]!.hex}
                onChange={(e) =>
                  updatePriority.mutate({ pageId, id: item.id, color: e.target.value as string })
                }
                sx={{ minWidth: 96 }}
              >
                {KANBAN_LABEL_COLORS.map((c) => (
                  <MenuItem key={c.hex} value={c.hex}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: c.hex }} />
                      <span>{c.name}</span>
                    </Stack>
                  </MenuItem>
                ))}
              </Select>
            )}
          />
        ) : null}

        {tab === 'labels' ? (
          <SortableList
            items={board.labels.map((l) => ({ id: l.id, title: l.name, position: l.position, color: l.color }))}
            addPlaceholder="Новая метка"
            onAdd={(title) => createLabel.mutateAsync({ pageId, name: title, color: KANBAN_LABEL_COLORS[0]!.hex })}
            onRename={(id, title) => updateLabel.mutateAsync({ pageId, id, name: title })}
            onReorder={(id, beforeId, afterId) =>
              reorderLabel.mutateAsync({ pageId, id, beforeId, afterId })
            }
            onDelete={(id) => deleteLabel.mutateAsync({ pageId, id })}
            extraColumn={(item) => (
              <Select
                size="small"
                value={item.color ?? KANBAN_LABEL_COLORS[0]!.hex}
                onChange={(e) =>
                  updateLabel.mutate({ pageId, id: item.id, color: e.target.value as string })
                }
                sx={{ minWidth: 96 }}
              >
                {KANBAN_LABEL_COLORS.map((c) => (
                  <MenuItem key={c.hex} value={c.hex}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: c.hex }} />
                      <span>{c.name}</span>
                    </Stack>
                  </MenuItem>
                ))}
              </Select>
            )}
          />
        ) : null}

        {tab === 'statuses' ? (
          <SortableList
            items={board.columns.map((c) => ({ id: c.id, title: c.title, position: c.position, color: c.color }))}
            addPlaceholder="Новая колонка"
            onAdd={(title) => createColumn.mutateAsync({ pageId, title, kind: 'ACTIVE' })}
            onRename={(id, title) => updateColumn.mutateAsync({ pageId, id, title })}
            onReorder={(id, beforeId, afterId) =>
              reorderColumn.mutateAsync({ pageId, id, beforeId, afterId })
            }
            onDelete={async (id) => {
              const col = board.columns.find((c) => c.id === id)
              const target = board.columns
                .filter((c) => c.id !== id)
                .sort((a, b) => a.position - b.position)[0]
              const message = target
                ? `Удалить колонку «${col?.title ?? ''}»? Задачи переедут в «${target.title}».`
                : 'Удалить колонку?'
              if (typeof globalThis.confirm === 'function' && !globalThis.confirm(message)) return
              await deleteColumn.mutateAsync({ pageId, id })
            }}
            canDelete={() => board.columns.length > 1}
            extraColumn={(item) => {
              const current = board.columns.find((c) => c.id === item.id)
              return (
                <Select
                  size="small"
                  value={current?.kind ?? 'ACTIVE'}
                  onChange={(e) =>
                    updateColumn.mutate({
                      pageId,
                      id: item.id,
                      kind: e.target.value as 'ACTIVE' | 'DONE' | 'CANCELLED',
                    })
                  }
                  sx={{ minWidth: 120 }}
                >
                  <MenuItem value="ACTIVE">Активная</MenuItem>
                  <MenuItem value="DONE">Закрыта</MenuItem>
                  <MenuItem value="CANCELLED">Отменена</MenuItem>
                </Select>
              )
            }}
          />
        ) : null}

        {tab === 'participants' ? <ParticipantsTab pageId={pageId} board={board} /> : null}
      </DialogContent>
    </Dialog>
  )
}
