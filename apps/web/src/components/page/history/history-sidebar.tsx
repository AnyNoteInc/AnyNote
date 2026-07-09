'use client'

import { useMemo, useState } from 'react'

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  CloseIcon,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  IconButton,
  RestoreIcon,
  Stack,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { usePageHistoryContext } from './history-context'
import { RevisionList, type RevisionItem } from './revision-list'
import { RevisionPreview } from './revision-preview'

export const HISTORY_SIDEBAR_WIDTH = 320

export function HistorySidebar() {
  const { enabled, panelOpen, pageId, workspaceId, closePanel } = usePageHistoryContext()
  const utils = trpc.useUtils()

  const open = enabled && panelOpen
  const revisionsQ = trpc.page.history.listRevisions.useQuery(
    { pageId },
    { enabled: open, staleTime: 10_000 },
  )
  const membersQ = trpc.workspace.listMembers.useQuery({ workspaceId }, { enabled: open })

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [conflict, setConflict] = useState<string | null>(null)

  const restore = trpc.page.history.restoreRevision.useMutation({
    onSuccess: async () => {
      setConfirmOpen(false)
      setConflict(null)
      // The page content changed under it; refresh the page + its history so the
      // new RESTORE revision shows and the editor re-hydrates on next load.
      await Promise.all([
        utils.page.getById.invalidate({ id: pageId }),
        utils.page.history.listRevisions.invalidate({ pageId }),
      ])
      closePanel()
    },
    onError: (err) => {
      // Page deleted / archived between opening history and restoring → conflict.
      if (err.data?.code === 'NOT_FOUND' || err.data?.code === 'CONFLICT') {
        setConflict('Страница была удалена или перемещена — восстановление недоступно.')
      } else {
        setConflict(err.message)
      }
    },
  })

  const actorNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of membersQ.data ?? []) {
      const name = [m.user.firstName, m.user.lastName].filter(Boolean).join(' ').trim()
      map.set(m.user.id, name || m.user.email)
    }
    return map
  }, [membersQ.data])

  const resolveActorName = (actorId: string | null): string => {
    if (!actorId) return 'Система'
    return actorNames.get(actorId) ?? 'Участник'
  }

  if (!open) return null

  // `data` carries a recursive Prisma.JsonValue (`metadata`); widening through
  // `unknown` keeps TS off its deep-instantiation limit on the RevisionItem cast.
  const revisions = ((revisionsQ.data ?? []) as unknown as RevisionItem[]).slice()

  return (
    <Box
      className="history-sidebar"
      sx={{
        width: HISTORY_SIDEBAR_WIDTH,
        flexShrink: 0,
        position: 'relative',
        zIndex: 10,
        bgcolor: 'background.default',
        borderLeft: 1,
        borderColor: 'divider',
        height: '100%',
        overflow: 'auto',
        p: 1.5,
      }}
    >
      <Stack
        direction="row"

        sx={{ mb: 1, alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Typography variant="subtitle2">История</Typography>
        <IconButton size="small" onClick={closePanel} aria-label="Закрыть историю">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>

      {revisionsQ.isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={20} />
        </Box>
      ) : revisionsQ.isError ? (
        <Alert severity="info" variant="outlined" sx={{ fontSize: 13 }}>
          {revisionsQ.error.data?.code === 'FORBIDDEN'
            ? 'История страницы доступна только редакторам.'
            : (revisionsQ.error.message ?? 'История недоступна.')}
        </Alert>
      ) : revisions.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Пока нет сохранённых версий этой страницы.
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          <RevisionList
            revisions={revisions}
            selectedId={selectedId}
            resolveActorName={resolveActorName}
            onSelect={(id) => {
              setSelectedId(id)
              setConflict(null)
            }}
          />

          {selectedId ? (
            <>
              <Divider />
              <Stack spacing={1}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                  Предпросмотр
                </Typography>
                <RevisionPreview pageId={pageId} revisionId={selectedId} />
                {conflict ? (
                  <Alert severity="warning" variant="outlined" sx={{ fontSize: 13 }}>
                    {conflict}
                  </Alert>
                ) : null}
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<RestoreIcon fontSize="small" />}
                  onClick={() => setConfirmOpen(true)}
                  disabled={restore.isPending}
                >
                  Восстановить
                </Button>
              </Stack>
            </>
          ) : null}
        </Stack>
      )}

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Восстановить версию?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: 14 }}>
            Содержимое страницы будет заменено выбранной версией. Текущая версия сохранится в
            истории, поэтому это действие можно отменить.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)} disabled={restore.isPending}>
            Отмена
          </Button>
          <Button
            variant="contained"
            disabled={!selectedId || restore.isPending}
            onClick={() => {
              if (selectedId) restore.mutate({ pageId, revisionId: selectedId })
            }}
          >
            Восстановить
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
