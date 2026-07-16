'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { Box, Button, CircularProgress, Stack, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { DatabaseViewTabs } from './database-view-tabs'
import { DatabaseTableView } from './database-table-view'
import { DatabaseBoardView } from './views/database-board-view'
import { DatabaseCalendarView } from './views/database-calendar-view'
import { DatabaseListView } from './views/database-list-view'
import { DatabaseItemModal } from './database-item-modal'
import { FormBuilder } from './forms/form-builder'
import {
  ActiveViewIdProvider,
  DatabaseWorkspaceIdProvider,
} from './cell-editors/use-optimistic-cell'
import type { DatabaseSchema, DatabaseViewEntry, DatabaseViewProps } from './types'

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
 * `database.getByPage` (source + views + properties, NO rows — rows are fetched
 * view-aware via `listRows` inside each view component). It resolves the active
 * view from `?viewId=` (fallback the first view), renders the view tab strip and
 * the layout for the active view's type. If the page has no source yet (a legacy
 * DATABASE page) `getByPage` throws NOT_FOUND and we surface a "Создать базу"
 * action that calls `database.repairSource` (idempotent `seedDefaults`).
 */
export function DatabasePageRenderer({ pageId, editable = true }: DatabasePageRendererProps) {
  const utils = trpc.useUtils()
  const searchParams = useSearchParams()
  const requestedViewId = searchParams?.get('viewId') ?? null

  const {
    data: schema,
    isLoading,
    error,
    refetch,
  } = trpc.database.getByPage.useQuery({ pageId }, { retry: false })

  const repairSource = trpc.database.repairSource.useMutation({
    onSuccess: async () => {
      await utils.database.getByPage.invalidate({ pageId })
      await refetch()
    },
  })

  // Resolve the active view: the `?viewId=` param if it names a real view, else
  // the first view by position. Memoised so the dispatched component is stable.
  const activeView = useMemo<DatabaseViewEntry | null>(() => {
    if (!schema) return null
    const sorted = [...schema.views].sort((a, b) => a.position - b.position)
    return sorted.find((v) => v.id === requestedViewId) ?? sorted[0] ?? null
  }, [schema, requestedViewId])

  if (isLoading) return <CenteredSpinner />

  // A missing source surfaces as NOT_FOUND from getByPage. Offer to create one
  // (when the user may edit); otherwise show the error.
  const isMissingSource = error?.data?.code === 'NOT_FOUND'

  if (error && isMissingSource) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <Stack spacing={2} sx={{ p: 4, alignItems: 'center' }}>
          <Typography color="text.secondary">
            База данных для этой страницы ещё не создана.
          </Typography>
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

  if (!activeView) {
    return (
      <Box sx={{ p: 4 }}>
        <Typography color="text.secondary">У этой базы нет представлений.</Typography>
      </Box>
    )
  }

  // Permission-aware gates (server truth from `getByPage().myAccess`, combined with
  // the page-level write flag). Content rights drive cell/row editing; structure
  // rights drive schema/view affordances. `editable` propagated to the views means
  // "may edit content" so the shared cell editors stay readonly for a viewer without
  // content rights (per-row gating is a documented follow-up — see ViewDispatch).
  const canEditContent = editable && schema.myAccess.canEditContent
  const canEditStructure = editable && schema.myAccess.canEditStructure
  const canManageExposure = editable && schema.myAccess.canManageExposure

  return (
    // Provide the active view's id so the shared cell editors patch the right
    // listRows cache entry (keyed by pageId+viewId) without threading viewId props
    // through every editor.
    <DatabaseWorkspaceIdProvider value={schema.source.workspaceId}>
      <ActiveViewIdProvider value={activeView.id}>
        <Stack sx={{ height: '100%', minHeight: 0, bgcolor: 'background.paper' }}>
          <DatabaseViewTabs
            pageId={pageId}
            views={schema.views}
            activeViewId={activeView.id}
            editable={canEditStructure}
            myAccess={schema.myAccess}
          />
          <ViewDispatch
            pageId={pageId}
            schema={schema}
            view={activeView}
            editable={canEditContent}
            canEditStructure={canEditStructure}
            canManageExposure={canManageExposure}
          />
        </Stack>
        {/* FORM responses own their authoritative rowOverride modal. Other views
            resolve a row from their shared active-view cache here. */}
        {activeView.type === 'FORM' ? null : (
          <DatabaseItemModal
            pageId={pageId}
            viewId={activeView.id}
            schema={schema}
            editable={canEditContent}
          />
        )}
      </ActiveViewIdProvider>
    </DatabaseWorkspaceIdProvider>
  )
}

/** Dispatch to the layout component for the active view's type. */
function ViewDispatch({
  pageId,
  schema,
  view,
  editable,
  canEditStructure,
  canManageExposure,
}: {
  readonly pageId: string
  readonly schema: DatabaseSchema
  readonly view: DatabaseViewEntry
  readonly editable: boolean
  readonly canEditStructure: boolean
  readonly canManageExposure: boolean
}) {
  const props: DatabaseViewProps = {
    pageId,
    viewId: view.id,
    view,
    properties: schema.properties,
    systemTitleProperty: schema.systemTitleProperty,
    editable,
    canEditStructure,
    myAccess: schema.myAccess,
  }
  switch (view.type) {
    case 'FORM':
      return (
        <FormBuilder
          pageId={pageId}
          formViewId={view.id}
          canEditStructure={canEditStructure}
          canManageExposure={canManageExposure}
          canEditContent={editable}
        />
      )
    case 'BOARD':
      return <DatabaseBoardView {...props} />
    case 'CALENDAR':
      return <DatabaseCalendarView {...props} />
    case 'LIST':
      return <DatabaseListView {...props} />
    case 'TABLE':
    default:
      return <DatabaseTableView {...props} />
  }
}
