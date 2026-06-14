'use client'

import { useMemo } from 'react'

import type { DashboardDataResult, DashboardReadResult } from '@repo/trpc'
import type { WidgetDataResult } from '@repo/domain'
import { Box, CircularProgress, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { WidgetFrame } from './widget-frame'
import { WidgetBody } from './widgets'

interface DashboardPageRendererProps {
  readonly pageId: string
  readonly editable?: boolean
}

// The grid's column count (react-grid-layout's default; Task 5 wires the live
// grid — this minimal renderer mirrors the same 12-column coordinate space so a
// widget's persisted gridX/W lay out identically once the drag grid lands).
const GRID_COLS = 12
const ROW_HEIGHT = 110

function CenteredSpinner() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
      <CircularProgress />
    </Box>
  )
}

function CenteredMessage({ children }: { readonly children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
      <Typography color="text.secondary" sx={{ p: 4, textAlign: 'center' }}>
        {children}
      </Typography>
    </Box>
  )
}

/**
 * MINIMAL DASHBOARD renderer (Task 4). Loads the dashboard shell
 * (`dashboard.getByPage`, object-hiding union) + the per-viewer widget data
 * (`dashboard.dashboardData`) and lays the widgets out in a static CSS grid by
 * their persisted gridX/Y/W/H — no drag/resize, no settings dialog yet. Task 5
 * upgrades this to the react-grid-layout editor with edit/view mode + the
 * widget-settings dialog + the global-filter bar. The `editable` flag is threaded
 * through to {@link WidgetFrame} so the (future) per-widget affordances appear
 * only for editors; here it merely reflects the read result's `editable`.
 */
export function DashboardPageRenderer({ pageId, editable = true }: DashboardPageRendererProps) {
  const shell = trpc.dashboard.getByPage.useQuery({ pageId }, { retry: false })

  const dashboardId =
    shell.data?.status === 'ok'
      ? (shell.data as Extract<DashboardReadResult, { status: 'ok' }>).dashboard.id
      : null

  const data = trpc.dashboard.dashboardData.useQuery(
    { dashboardId: dashboardId ?? '' },
    { enabled: Boolean(dashboardId), retry: false },
  )

  // widgetId → its aggregated result (for the static lookup below).
  const resultById = useMemo(() => {
    const map = new Map<string, WidgetDataResult>()
    if (data.data?.status === 'ok') {
      for (const w of (data.data as Extract<DashboardDataResult, { status: 'ok' }>).widgets) {
        map.set(w.widgetId, w.result)
      }
    }
    return map
  }, [data.data])

  if (shell.isLoading || !shell.data) return <CenteredSpinner />
  if (shell.data.status === 'no_access') {
    return <CenteredMessage>У вас нет доступа к этому дашборду.</CenteredMessage>
  }
  if (shell.data.status === 'not_found') {
    return <CenteredMessage>Дашборд не найден.</CenteredMessage>
  }

  const { dashboard, widgets } = shell.data
  // The read result's editable wins over the prop (the server is the authority);
  // both must be true for the (future) edit affordances.
  const canEdit = editable && shell.data.editable

  return (
    <Box
      sx={{ height: '100%', overflow: 'auto', bgcolor: 'background.default' }}
      data-testid="dashboard-page"
    >
      <Box sx={{ maxWidth: 1280, mx: 'auto', width: '100%', p: { xs: 2, sm: 3 } }}>
        <Typography variant="h5" sx={{ mb: 3 }}>
          {dashboard.title}
        </Typography>

        {widgets.length === 0 ? (
          <CenteredMessage>В этом дашборде пока нет виджетов.</CenteredMessage>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
              gridAutoRows: `${ROW_HEIGHT}px`,
              gap: 2,
            }}
          >
            {widgets.map((w) => {
              const colStart = Math.min(w.gridX, GRID_COLS - 1) + 1
              const colSpan = Math.max(1, Math.min(w.gridW, GRID_COLS - (colStart - 1)))
              const rowStart = w.gridY + 1
              const rowSpan = Math.max(1, w.gridH)
              return (
                <Box
                  key={w.id}
                  sx={{
                    gridColumn: `${colStart} / span ${colSpan}`,
                    gridRow: `${rowStart} / span ${rowSpan}`,
                    minHeight: 0,
                  }}
                  data-testid="dashboard-widget"
                  data-widget-type={w.type}
                >
                  <WidgetFrame title={w.title} editable={false}>
                    {data.isLoading && !resultById.has(w.id) ? (
                      <CenteredSpinner />
                    ) : (
                      <WidgetBody
                        type={w.type}
                        result={resultById.get(w.id)}
                        config={w.config}
                        title={w.title}
                      />
                    )}
                  </WidgetFrame>
                </Box>
              )
            })}
          </Box>
        )}

        {canEdit ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3 }}>
            Редактирование дашборда появится в ближайшем обновлении.
          </Typography>
        ) : null}
      </Box>
    </Box>
  )
}
