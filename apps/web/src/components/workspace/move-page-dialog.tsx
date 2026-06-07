'use client'

import { useEffect, useState } from 'react'

import {
  Alert,
  Button,
  ButtonGroup,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  GroupIcon,
  LockIcon,
  Stack,
} from '@repo/ui/components'
import { trpc } from '@/trpc/client'

import {
  PAGE_TREE_ROOT,
  PageTreePicker,
  getDescendantIds,
  type PageTreeSelection,
} from './page-tree-picker'
import { type PageItem } from './types'

type Props = {
  open: boolean
  onClose: () => void
  page: PageItem
  pages: PageItem[]
  workspaceId: string
}

type Destination = 'team' | 'private'

export function MovePageDialog({ open, onClose, page, pages, workspaceId }: Props) {
  const utils = trpc.useUtils()
  const [selectedId, setSelectedId] = useState<PageTreeSelection | null>(null)
  const [destination, setDestination] = useState<Destination>('team')

  // Resolve the page's current collection kind so we can pre-select the matching
  // destination and detect a private → team visibility change.
  const { data: collections } = trpc.collection.list.useQuery(
    { workspaceId },
    { enabled: open },
  )
  const currentKind = collections?.find((c) => c.id === page.collectionId)?.kind ?? null
  const currentDestination: Destination | null =
    currentKind === 'TEAM' ? 'team' : currentKind === 'PERSONAL' ? 'private' : null

  // Pre-select the page's current collection each time the dialog opens (default
  // to Команда when the kind is unknown).
  useEffect(() => {
    if (open) setDestination(currentDestination ?? 'team')
  }, [open, currentDestination])

  const move = trpc.page.move.useMutation()
  const moveToCollection = trpc.page.moveToCollection.useMutation()

  const excludeIds = new Set([page.id, ...getDescendantIds(page.id, pages)])

  const collectionChanged = currentDestination !== null && destination !== currentDestination
  const showVisibilityWarning = currentDestination === 'private' && destination === 'team'

  const handleConfirm = async () => {
    if (selectedId === null) return
    const newParentId = selectedId === PAGE_TREE_ROOT ? null : selectedId

    if (collectionChanged) {
      await moveToCollection.mutateAsync({ pageId: page.id, workspaceId, target: destination })
    }
    if (newParentId !== page.parentId) {
      await move.mutateAsync({ pageId: page.id, newParentId })
    }

    await utils.page.listByWorkspace.invalidate({ workspaceId })
    await utils.collection.list.invalidate({ workspaceId })
    onClose()
  }

  const isPending = move.isPending || moveToCollection.isPending

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{`Переместить «${page.title ?? 'Новая страница'}»`}</DialogTitle>
      <DialogContent sx={{ p: 1 }}>
        <Stack spacing={1.5}>
          <ButtonGroup fullWidth size="small">
            <Button
              startIcon={<GroupIcon fontSize="small" />}
              variant={destination === 'team' ? 'contained' : 'outlined'}
              onClick={() => setDestination('team')}
            >
              Команда
            </Button>
            <Button
              startIcon={<LockIcon fontSize="small" />}
              variant={destination === 'private' ? 'contained' : 'outlined'}
              onClick={() => setDestination('private')}
            >
              Личное
            </Button>
          </ButtonGroup>

          {showVisibilityWarning ? (
            <Alert severity="warning">Страница станет видна всей команде</Alert>
          ) : null}

          <PageTreePicker
            pages={pages}
            excludeIds={excludeIds}
            onSelect={setSelectedId}
            selectedId={selectedId}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onClose}>
          Отмена
        </Button>
        <Button
          onClick={() => void handleConfirm()}
          variant="contained"
          disabled={selectedId === null || isPending}
        >
          Переместить
        </Button>
      </DialogActions>
    </Dialog>
  )
}
