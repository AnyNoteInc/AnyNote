'use client'

// react-grid-layout's flat-prop "legacy" API (isDraggable/isResizable/
// draggableHandle/WidthProvider/Responsive). The package's `.` root export is the
// rewritten v2 composable API (dragConfig/resizeConfig objects); the `/legacy`
// subpath is the classic prop surface this renderer targets. The grid's CSS
// (`react-grid-layout/css/styles.css`) ALSO bundles the `.react-resizable-handle`
// rules, so the separate `react-resizable/css/styles.css` import the plan mentions
// is unnecessary (and unresolvable — react-resizable isn't hoisted to apps/web).
// This whole component is dynamic(ssr:false) in page-renderer, so the side-effect
// CSS import + the window-touching grid never run on the server.
import 'react-grid-layout/css/styles.css'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Responsive, WidthProvider, type Layout } from 'react-grid-layout/legacy'

import type { DashboardDataResult, DashboardReadResult, DashboardWidgetDto } from '@repo/trpc'
import type { WidgetDataResult } from '@repo/domain'
import {
  AddIcon,
  Box,
  Button,
  CircularProgress,
  EditIcon,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  VisibilityIcon,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { GlobalFilterBar } from './global-filter-bar'
import { WidgetFrame } from './widget-frame'
import { WidgetSettingsDialog } from './widget-settings-dialog'
import { WidgetBody } from './widgets'

const ResponsiveGridLayout = WidthProvider(Responsive)

// The grid coordinate space (matches the widget gridX/W persisted by the router;
// the settings dialog's default grid is 4×4). 12 cols at the lg breakpoint, fewer
// on narrow screens (react-grid-layout re-flows when cols shrink).
const COLS = { lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 } as const
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 } as const
const ROW_HEIGHT = 90
const LAYOUT_DEBOUNCE_MS = 600

interface DashboardPageRendererProps {
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
 * The DASHBOARD page renderer: a react-grid-layout grid of widgets with an
 * editor-gated edit/view toggle.
 *
 * - Loads the shell (`dashboard.getByPage`, object-hiding union) + the per-viewer
 *   widget data (`dashboard.dashboardData`).
 * - VIEW mode (default): drag/resize OFF, read-only — no add/settings/remove.
 * - EDIT mode (editors only): drag via the widget-frame header
 *   (`draggableHandle`), resize via the grid corner handle; layout changes
 *   persist (debounced) via `dashboard.updateLayout`. An "Добавить виджет" button
 *   opens the settings dialog; each frame exposes settings/remove. A global-filter
 *   bar declares cross-widget filters.
 *
 * The server's `editable` flag is authoritative — the edit toggle and all
 * affordances are hidden when the caller can't edit the page (spec §7.3).
 */
export function DashboardPageRenderer({ pageId, editable = true }: DashboardPageRendererProps) {
  const utils = trpc.useUtils()
  const shell = trpc.dashboard.getByPage.useQuery({ pageId }, { retry: false })

  const dashboardId =
    shell.data?.status === 'ok'
      ? (shell.data as Extract<DashboardReadResult, { status: 'ok' }>).dashboard.id
      : null

  const data = trpc.dashboard.dashboardData.useQuery(
    { dashboardId: dashboardId ?? '' },
    { enabled: Boolean(dashboardId), retry: false },
  )

  const [mode, setMode] = useState<'view' | 'edit'>('view')
  // The widget the settings dialog edits (null = closed; 'new' = add a fresh one).
  const [dialogWidget, setDialogWidget] = useState<DashboardWidgetDto | null | 'new'>(null)

  const updateLayout = trpc.dashboard.updateLayout.useMutation()
  const removeWidget = trpc.dashboard.removeWidget.useMutation()

  // widgetId → its aggregated result.
  const resultById = useMemo(() => {
    const map = new Map<string, WidgetDataResult>()
    if (data.data?.status === 'ok') {
      for (const w of (data.data as Extract<DashboardDataResult, { status: 'ok' }>).widgets) {
        map.set(w.widgetId, w.result)
      }
    }
    return map
  }, [data.data])

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    },
    [],
  )

  const persistLayout = useCallback(
    (layout: Layout) => {
      if (!dashboardId) return
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        updateLayout.mutate({
          dashboardId,
          layout: layout.map((l) => ({ id: l.i, x: l.x, y: l.y, w: l.w, h: l.h })),
        })
      }, LAYOUT_DEBOUNCE_MS)
    },
    [dashboardId, updateLayout],
  )

  const handleRemove = useCallback(
    (widgetId: string) => {
      removeWidget.mutate(
        { widgetId },
        {
          onSuccess: async () => {
            await utils.dashboard.getByPage.invalidate({ pageId })
            await utils.dashboard.dashboardData.invalidate()
          },
        },
      )
    },
    [removeWidget, utils, pageId],
  )

  if (shell.isLoading || !shell.data) return <CenteredSpinner />
  if (shell.data.status === 'no_access') {
    return <CenteredMessage>У вас нет доступа к этому дашборду.</CenteredMessage>
  }
  if (shell.data.status === 'not_found') {
    return <CenteredMessage>Дашборд не найден.</CenteredMessage>
  }

  const { dashboard, widgets, globalFilters } = shell.data
  // The server's editable wins (the prop is the page-level write flag).
  const canEdit = editable && shell.data.editable
  const editing = canEdit && mode === 'edit'

  // The persisted layout (the same x/y/w/h for every breakpoint; react-grid-layout
  // re-flows it down when narrower cols can't fit the widget).
  const layout: Layout = widgets.map((w) => ({
    i: w.id,
    x: w.gridX,
    y: w.gridY,
    w: w.gridW,
    h: w.gridH,
  }))
  const layouts = { lg: layout, md: layout, sm: layout, xs: layout, xxs: layout }

  return (
    <Box
      sx={{ height: '100%', overflow: 'auto', bgcolor: 'background.default' }}
      data-testid="dashboard-page"
    >
      <Box sx={{ maxWidth: 1320, mx: 'auto', width: '100%', p: { xs: 2, sm: 3 } }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            mb: 2,
            gap: 2,
          }}
        >
          <Typography variant="h5" noWrap sx={{ minWidth: 0 }}>
            {dashboard.title}
          </Typography>
          {canEdit ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
              {editing ? (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => setDialogWidget('new')}
                  data-testid="add-widget-button"
                >
                  Добавить виджет
                </Button>
              ) : null}
              <ToggleButtonGroup
                size="small"
                exclusive
                value={mode}
                onChange={(_, next: 'view' | 'edit' | null) => next && setMode(next)}
                aria-label="Режим дашборда"
              >
                <ToggleButton value="view" aria-label="Просмотр">
                  <VisibilityIcon fontSize="small" sx={{ mr: 0.5 }} />
                  Просмотр
                </ToggleButton>
                <ToggleButton value="edit" aria-label="Редактирование">
                  <EditIcon fontSize="small" sx={{ mr: 0.5 }} />
                  Редактирование
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>
          ) : null}
        </Box>

        {editing || globalFilters.length > 0 ? (
          <GlobalFilterBar
            dashboardId={dashboard.id}
            filters={globalFilters}
            editable={editing}
            onSaved={() => void utils.dashboard.dashboardData.invalidate()}
          />
        ) : null}

        {widgets.length === 0 ? (
          <CenteredMessage>
            В этом дашборде пока нет виджетов.
            {canEdit ? ' Перейдите в режим редактирования, чтобы добавить виджет.' : ''}
          </CenteredMessage>
        ) : (
          <ResponsiveGridLayout
            className="layout"
            layouts={layouts}
            cols={COLS}
            breakpoints={BREAKPOINTS}
            rowHeight={ROW_HEIGHT}
            margin={[16, 16]}
            isDraggable={editing}
            isResizable={editing}
            draggableHandle=".dashboard-widget-drag-handle"
            onLayoutChange={(next) => {
              if (editing) persistLayout(next)
            }}
          >
            {widgets.map((w) => (
              <Box
                key={w.id}
                data-testid="dashboard-widget"
                data-widget-type={w.type}
                sx={{ height: '100%' }}
              >
                <WidgetFrame
                  title={w.title}
                  editable={editing}
                  onSettings={() => setDialogWidget(w)}
                  onRemove={() => handleRemove(w.id)}
                >
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
            ))}
          </ResponsiveGridLayout>
        )}
      </Box>

      {canEdit && dialogWidget !== null ? (
        <WidgetSettingsDialog
          open
          workspaceId={dashboard.workspaceId}
          dashboardId={dashboard.id}
          widget={dialogWidget === 'new' ? null : dialogWidget}
          onClose={() => setDialogWidget(null)}
          onSaved={() => {
            void utils.dashboard.getByPage.invalidate({ pageId })
            void utils.dashboard.dashboardData.invalidate()
          }}
        />
      ) : null}
    </Box>
  )
}
