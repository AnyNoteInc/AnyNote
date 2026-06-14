'use client'

import { Box, Typography } from '@repo/ui/components'

// Mirrors `MAX_WIDGET_ROWS` (= 5000) from `@repo/domain` dashboard dto. It is
// NOT imported from `@repo/domain` here: the dashboard dto leaf transitively
// pulls the database barrel → `@repo/db` (`pg`/`net`/`tls`), which a client
// bundle can't resolve, and the domain-module-isolation rule forbids the dto
// from deep-importing a client-safe database leaf. Only TYPES cross the boundary
// (erased); this single value is duplicated. If the server cap changes, change
// it here too — the drift-guard test in `dashboard-grouped-to-series.test.ts`
// pins `WIDGET_ROW_CAP === MAX_WIDGET_ROWS`.
export const WIDGET_ROW_CAP = 5000

/**
 * The shared placeholder/notice surfaces for a widget's `WidgetDataResult`. The
 * aggregation service hides objects honestly (spec §7.6): a widget the viewer
 * can't read renders «Нет доступа», never the underlying data; a metric/group
 * pointed at a hidden-or-computed property renders «Свойство скрыто»; an error
 * renders the sanitized message. `truncated:true` (the MAX_WIDGET_ROWS cap was
 * hit) surfaces a «показаны первые N» notice rather than silently lying.
 */

function CenteredNotice({ children }: { readonly children: React.ReactNode }) {
  return (
    <Box
      sx={{
        height: '100%',
        minHeight: 80,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        px: 2,
      }}
    >
      <Typography variant="body2" color="text.secondary">
        {children}
      </Typography>
    </Box>
  )
}

export function WidgetNoAccess() {
  return <CenteredNotice>Нет доступа</CenteredNotice>
}

export function WidgetHiddenProperty() {
  return <CenteredNotice>Свойство скрыто</CenteredNotice>
}

export function WidgetError({ message }: { readonly message: string }) {
  return (
    <CenteredNotice>
      <Box component="span" sx={{ color: 'error.main' }}>
        {message || 'Не удалось загрузить виджет'}
      </Box>
    </CenteredNotice>
  )
}

export function WidgetEmpty({ children = 'Нет данных' }: { readonly children?: React.ReactNode }) {
  return <CenteredNotice>{children}</CenteredNotice>
}

/** The «показаны первые N» footer shown when the aggregation hit its row cap. */
export function WidgetTruncatedNotice() {
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      sx={{ display: 'block', mt: 0.5, fontStyle: 'italic' }}
    >
      Показаны первые {WIDGET_ROW_CAP} строк
    </Typography>
  )
}
