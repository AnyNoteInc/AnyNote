'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { DatabaseItemModal } from '../database-item-modal'
import type { DatabaseFormResponse, DatabaseSchema } from '../types'

interface FormResponsesPanelProps {
  readonly open: boolean
  readonly pageId: string
  readonly formId: string
  readonly formViewId: string
  readonly schema: DatabaseSchema
  readonly editable: boolean
  readonly onClose: () => void
}

export function FormResponsesPanel({
  open,
  pageId,
  formId,
  formViewId,
  schema,
  editable,
  onClose,
}: FormResponsesPanelProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [selected, setSelected] = useState<DatabaseFormResponse | null>(null)
  const responses = trpc.database.listFormResponses.useInfiniteQuery(
    { pageId, formId, limit: 25 },
    {
      enabled: open,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    },
  )
  const items = useMemo(
    () => responses.data?.pages.flatMap((page) => page.items) ?? [],
    [responses.data],
  )

  function openResponse(response: DatabaseFormResponse) {
    setSelected(response)
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set('rowId', response.row.rowId)
    params.set('viewId', formViewId)
    router.replace(`?${params.toString()}`)
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        <DialogTitle>Ответы формы</DialogTitle>
        <DialogContent sx={{ minHeight: 320 }}>
          {responses.isLoading ? (
            <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 260 }}>
              <CircularProgress />
            </Box>
          ) : items.length === 0 ? (
            <Box
              sx={{ display: 'grid', placeItems: 'center', minHeight: 260, textAlign: 'center' }}
            >
              <Stack spacing={0.75}>
                <Typography variant="h6">Пока нет ответов</Typography>
                <Typography variant="body2" color="text.secondary">
                  Новые записи появятся здесь после отправки формы.
                </Typography>
              </Stack>
            </Box>
          ) : (
            <Stack spacing={0.75}>
              {items.map((response) => (
                <Box
                  component="button"
                  type="button"
                  key={response.submissionId}
                  onClick={() => openResponse(response)}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) auto',
                    gap: 2,
                    alignItems: 'center',
                    width: '100%',
                    minHeight: 56,
                    px: 1.5,
                    py: 1,
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1.5,
                    bgcolor: 'background.paper',
                    color: 'text.primary',
                    textAlign: 'left',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'action.hover' },
                    '&:focus-visible': {
                      outline: '2px solid',
                      outlineColor: 'primary.main',
                      outlineOffset: 2,
                    },
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
                      {response.row.title || 'Без названия'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {response.endingId}
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(response.submittedAt).toLocaleString('ru-RU')}
                  </Typography>
                </Box>
              ))}
              {responses.hasNextPage ? (
                <Button
                  disabled={responses.isFetchingNextPage}
                  onClick={() => responses.fetchNextPage()}
                  sx={{ minHeight: 44 }}
                >
                  {responses.isFetchingNextPage ? 'Загрузка…' : 'Показать ещё'}
                </Button>
              ) : null}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Закрыть</Button>
        </DialogActions>
      </Dialog>
      {selected ? (
        <DatabaseItemModal
          pageId={pageId}
          viewId={formViewId}
          schema={schema}
          editable={editable}
          rowOverride={selected.row}
        />
      ) : null}
    </>
  )
}
