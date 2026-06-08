'use client'

import { Box, CircularProgress, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { DatabaseTableView } from './database-table-view'

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
 * (returning the `pageId` the table view drives mutations through) and renders
 * the SAME `DatabaseTableView` used full-page — editing a cell here updates the
 * source, and opening a row sets `?rowId=` on the host page (the table view's
 * RowTitleCell already does this). When readonly, the table hides write
 * affordances.
 */
export function EmbeddedDatabaseEmbed({ sourceId, readonly }: EmbeddedDatabaseEmbedProps) {
  const query = trpc.database.getBySourceId.useQuery(
    { sourceId: sourceId ?? '' },
    { enabled: Boolean(sourceId), retry: false },
  )

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

  if (query.isError || !query.data) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          База данных недоступна
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ maxHeight: 480, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <DatabaseTableView
        pageId={query.data.pageId}
        data={query.data.view}
        editable={!readonly}
      />
    </Box>
  )
}
