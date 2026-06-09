'use client'

import { useMemo } from 'react'
import { Box, CircularProgress, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { DatabaseTableView } from './database-table-view'
import { ActiveViewIdProvider, DatabaseWorkspaceIdProvider } from './cell-editors/use-optimistic-cell'

interface EmbeddedDatabaseEmbedProps {
  /** The DatabaseSource id stored on the editor node. */
  readonly sourceId: string | null
  /** Forces readonly (node-level flag OR a non-editable host editor). */
  readonly readonly: boolean
}

/**
 * Live inline render of a database SOURCE inside the text editor. This is the
 * apps/web half of the `embeddedDatabase` Tiptap node: the node view in
 * @repo/editor calls the injected `renderEmbed`, which mounts this component.
 *
 * It resolves the source to its DATABASE page via `database.getBySourceId`
 * (returning the schema + the `pageId` mutations route through) and renders the
 * SAME `DatabaseTableView` used full-page, anchored to the source's first view.
 * Editing a cell here updates the source; opening a row sets `?rowId=` on the host
 * page. When readonly, the table hides write affordances. (Per-view tabs are a
 * full-page affordance; the embed shows the default/first view.)
 */
export function EmbeddedDatabaseEmbed({ sourceId, readonly }: EmbeddedDatabaseEmbedProps) {
  const query = trpc.database.getBySourceId.useQuery(
    { sourceId: sourceId ?? '' },
    { enabled: Boolean(sourceId), retry: false },
  )

  const schema = query.data?.view
  const firstView = useMemo(() => {
    if (!schema) return null
    return [...schema.views].sort((a, b) => a.position - b.position)[0] ?? null
  }, [schema])

  if (!sourceId) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Источник базы данных не выбран
        </Typography>
      </Box>
    )
  }

  if (query.isPending) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
        <CircularProgress size={20} />
      </Box>
    )
  }

  if (query.isError || !query.data || !schema || !firstView) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          База данных недоступна
        </Typography>
      </Box>
    )
  }

  return (
    <DatabaseWorkspaceIdProvider value={schema.source.workspaceId}>
      <ActiveViewIdProvider value={firstView.id}>
        <Box sx={{ maxHeight: 480, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <DatabaseTableView
            pageId={query.data.pageId}
            viewId={firstView.id}
            view={firstView}
            properties={schema.properties}
            systemTitleProperty={schema.systemTitleProperty}
            editable={!readonly}
          />
        </Box>
      </ActiveViewIdProvider>
    </DatabaseWorkspaceIdProvider>
  )
}
