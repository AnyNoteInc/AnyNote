'use client'

import { Box, Button, CircularProgress, Stack, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { DatabaseTableView } from './database-table-view'
import { DatabaseItemModal } from './database-item-modal'
import { defaultRowsInput } from './types'

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
 * Full-page renderer for a DATABASE page. Loads the database SCHEMA via
 * `database.getByPage` and the active view's rows via `database.listRows`
 * (Phase-4A fetch split), then merges them into the `{ ...schema, rows }` shape
 * the table/modal consume. If the page has no source yet (a legacy DATABASE page
 * created before provisioning, or one whose dispatch was skipped) `getByPage`
 * throws NOT_FOUND and we surface a "Создать базу" action that calls
 * `database.repairSource` (idempotent `seedDefaults`).
 */
export function DatabasePageRenderer({ pageId, editable = true }: DatabasePageRendererProps) {
  const utils = trpc.useUtils()
  const { data: schema, isLoading, error, refetch } = trpc.database.getByPage.useQuery(
    { pageId },
    { retry: false },
  )
  // Default-view rows (no `viewId` → default TABLE settings). MVP fetches a single
  // bounded page; per-view selection + pagination arrive with `useViewRows` (Phase E).
  const { data: rowsResult } = trpc.database.listRows.useQuery(
    defaultRowsInput(pageId),
    { retry: false, enabled: !!schema },
  )

  const repairSource = trpc.database.repairSource.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.database.getByPage.invalidate({ pageId }),
        utils.database.listRows.invalidate({ pageId }),
      ])
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

  if (error || !schema) {
    return (
      <Box sx={{ p: 4 }}>
        <Typography color="error">
          Не удалось загрузить базу данных: {error?.message ?? 'неизвестная ошибка'}
        </Typography>
      </Box>
    )
  }

  // Merge schema + rows into the single shape the table/modal read. Rows stream in
  // after the schema (separate query), so default to [] until they arrive.
  const data = { ...schema, rows: rowsResult?.rows ?? [] }

  return (
    <>
      <DatabaseTableView pageId={pageId} data={data} editable={editable} />
      {/* Item "peek" modal — opens when `?rowId=` matches a row (set by the title cell). */}
      <DatabaseItemModal pageId={pageId} data={data} editable={editable} />
    </>
  )
}
