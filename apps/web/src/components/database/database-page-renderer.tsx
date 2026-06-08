'use client'

import { Box, Button, CircularProgress, Stack, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { DatabaseTableView } from './database-table-view'
import { DatabaseItemModal } from './database-item-modal'

interface DatabasePageRendererProps {
  readonly pageId: string
  readonly editable?: boolean
}

function CenteredSpinner() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
      <CircularProgress />
    </Box>
  )
}

/**
 * Full-page renderer for a DATABASE page. Loads the source view-model via
 * `database.getByPage`; if the page has no source yet (a legacy DATABASE page
 * created before provisioning, or one whose dispatch was skipped) the query
 * throws NOT_FOUND and we surface a "Создать базу" action that calls
 * `database.repairSource` (idempotent `seedDefaults`).
 */
export function DatabasePageRenderer({ pageId, editable = true }: DatabasePageRendererProps) {
  const utils = trpc.useUtils()
  const { data, isLoading, error, refetch } = trpc.database.getByPage.useQuery(
    { pageId },
    { retry: false },
  )

  const repairSource = trpc.database.repairSource.useMutation({
    onSuccess: async () => {
      await utils.database.getByPage.invalidate({ pageId })
      await refetch()
    },
  })

  if (isLoading) return <CenteredSpinner />

  // A missing source surfaces as NOT_FOUND from getByPage. Offer to create one
  // (when the user may edit); otherwise show the error.
  const isMissingSource = error?.data?.code === 'NOT_FOUND'

  if (error && isMissingSource) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <Stack spacing={2} alignItems="center" sx={{ p: 4 }}>
          <Typography color="text.secondary">База данных для этой страницы ещё не создана.</Typography>
          {editable ? (
            <Button
              variant="contained"
              disabled={repairSource.isPending}
              onClick={() => repairSource.mutate({ pageId })}
            >
              Создать базу
            </Button>
          ) : null}
        </Stack>
      </Box>
    )
  }

  if (error || !data) {
    return (
      <Box sx={{ p: 4 }}>
        <Typography color="error">
          Не удалось загрузить базу данных: {error?.message ?? 'неизвестная ошибка'}
        </Typography>
      </Box>
    )
  }

  return (
    <>
      <DatabaseTableView pageId={pageId} data={data} editable={editable} />
      {/* Item "peek" modal — opens when `?rowId=` matches a row (set by the title cell). */}
      <DatabaseItemModal pageId={pageId} data={data} editable={editable} />
    </>
  )
}
