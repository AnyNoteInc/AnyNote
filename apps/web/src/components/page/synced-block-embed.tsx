'use client'

import { useState } from 'react'
import {
  Box,
  CircularProgress,
  DeleteOutlineIcon,
  IconButton,
  LinkOffIcon,
  Menu,
  MenuItem,
  MoreVertIcon,
  OpenInNewIcon,
  Tooltip,
  Typography,
} from '@repo/ui/components'
import {
  AnyNotePlainEditor,
  SyncedBlockNestedEditor,
  type JSONContent,
  type SyncedBlockRenderArgs,
} from '@repo/editor'

import type { SyncedBlockReadResult } from '@repo/trpc'

import { trpc } from '@/trpc/client'

type SyncedBlockEmbedProps = SyncedBlockRenderArgs & {
  /** The current viewer (collaboration caret identity for the nested editor). */
  readonly user: { id: string; name: string; color: string }
  readonly yjsUrl: string
  readonly yjsToken: () => Promise<string>
}

function Placeholder({ text }: { readonly text: string }) {
  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="body2" color="text.secondary">
        {text}
      </Typography>
    </Box>
  )
}

/**
 * The apps/web half of the `syncedBlock` Tiptap node — the consumer the editor's
 * injected `renderSyncedBlock` mounts (mirrors `embedded-database-embed.tsx`). It
 * runs the access-checked `syncedBlock.getById` and switches on the typed union
 * (spec §5/§8):
 *
 *  - `ok` + editable  → a LIVE nested collaborative editor bound to the
 *    `syncedBlock:{blockId}` Yjs doc (the block-move second-provider precedent);
 *    edits propagate to every instance in real time.
 *  - `ok` + readOnly (VIEWER/COMMENTER) OR a non-editable host (public share) →
 *    the static snapshot rendered read-only — NO live connection (§8: anonymous /
 *    share viewers never open the nested doc; they get the server snapshot).
 *  - `no_access` → «Нет доступа к синхронизированному блоку».
 *  - `deleted`   → «Синхронизированный блок удалён».
 *  - `unsynced`  → if the «отсоединить все» content is available AND the host is
 *    editable, AUTO-inline + detach this node locally (the lazy per-instance
 *    detach, §7); otherwise render the snapshot read-only / a subtle «отвязан».
 */
export function SyncedBlockEmbed({
  blockId,
  editorEditable,
  detachInline,
  onOpenOrigin,
  user,
  yjsUrl,
  yjsToken,
}: SyncedBlockEmbedProps) {
  const query = trpc.syncedBlock.getById.useQuery(
    { id: blockId ?? '' },
    { enabled: Boolean(blockId), retry: false },
  )
  const utils = trpc.useUtils()
  const unsyncAll = trpc.syncedBlock.unsyncAll.useMutation()
  const deleteBlock = trpc.syncedBlock.delete.useMutation()
  const [menuEl, setMenuEl] = useState<HTMLElement | null>(null)
  const [autoDetached, setAutoDetached] = useState(false)

  // Cast the React-Query payload to the canonical router result type. The tRPC
  // inferred shape trips TS2589 (excessively deep) on discriminated-union
  // narrowing; the explicit type decouples us from that inference.
  const data = query.data as SyncedBlockReadResult | undefined

  // Lazy auto-detach for an «отсоединить все»-marked block (§7): once getById
  // returns 'unsynced' with content and the host is editable, inline the content
  // and remove this node locally. Guard with a flag so the post-detach re-render
  // (the node may briefly still exist) doesn't fire it twice.
  if (
    !autoDetached &&
    editorEditable &&
    data?.status === 'unsynced' &&
    data.content != null
  ) {
    setAutoDetached(true)
    const detachContent = data.content
    // Defer to a microtask so we don't dispatch a transaction during render.
    queueMicrotask(() => detachInline(detachContent as JSONContent | JSONContent[]))
  }

  if (!blockId) {
    return <Placeholder text="Синхронизированный блок не выбран" />
  }

  if (query.isPending) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
        <CircularProgress size={20} />
      </Box>
    )
  }

  if (query.isError || !data) {
    return <Placeholder text="Нет доступа к синхронизированному блоку" />
  }

  if (data.status === 'no_access') {
    return <Placeholder text="Нет доступа к синхронизированному блоку" />
  }

  if (data.status === 'deleted') {
    return <Placeholder text="Синхронизированный блок удалён" />
  }

  if (data.status === 'unsynced') {
    // Detached. If we have content, the read-only snapshot stands in until the
    // auto-detach above swaps the node for inlined blocks; an orphan with no
    // content (origin gone) gets a subtle note.
    if (data.content == null) {
      return <Placeholder text="Блок отвязан" />
    }
    return (
      <Box sx={{ pr: 1 }}>
        <AnyNotePlainEditor
          value={data.content as JSONContent}
          editable={false}
          onBlurSave={() => undefined}
        />
      </Box>
    )
  }

  // status === 'ok'
  const liveEditable = editorEditable && !data.readOnly

  const onDetachThis = () => {
    setMenuEl(null)
    // Inline the CURRENT snapshot in place of this node (this instance only).
    detachInline((data.content as JSONContent | JSONContent[] | null) ?? null)
  }

  const onUnsyncAll = () => {
    setMenuEl(null)
    unsyncAll.mutate(
      { id: blockId },
      { onSuccess: () => void utils.syncedBlock.getById.invalidate({ id: blockId }) },
    )
  }

  const onDelete = () => {
    setMenuEl(null)
    deleteBlock.mutate(
      { id: blockId },
      { onSuccess: () => void utils.syncedBlock.getById.invalidate({ id: blockId }) },
    )
  }

  return (
    <Box sx={{ position: 'relative', pr: editorEditable ? 4 : 1 }}>
      {editorEditable ? (
        <>
          <Tooltip title="Действия с синхронизированным блоком">
            <IconButton
              size="small"
              aria-label="Действия с синхронизированным блоком"
              onClick={(e) => setMenuEl(e.currentTarget)}
              sx={{ position: 'absolute', top: 4, right: 28, zIndex: 2 }}
            >
              <MoreVertIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Menu anchorEl={menuEl} open={Boolean(menuEl)} onClose={() => setMenuEl(null)}>
            <MenuItem onClick={() => { setMenuEl(null); onOpenOrigin(data.originPageId) }}>
              <OpenInNewIcon fontSize="small" sx={{ mr: 1 }} />
              Открыть оригинал
            </MenuItem>
            <MenuItem onClick={onDetachThis}>
              <LinkOffIcon fontSize="small" sx={{ mr: 1 }} />
              Отсоединить эту копию
            </MenuItem>
            <MenuItem onClick={onUnsyncAll} disabled={data.readOnly}>
              <LinkOffIcon fontSize="small" sx={{ mr: 1 }} />
              Отсоединить все
            </MenuItem>
            <MenuItem onClick={onDelete} disabled={data.readOnly}>
              <DeleteOutlineIcon fontSize="small" sx={{ mr: 1 }} />
              Удалить блок
            </MenuItem>
          </Menu>
        </>
      ) : null}

      {liveEditable ? (
        <SyncedBlockNestedEditor
          blockId={blockId}
          yjsUrl={yjsUrl}
          yjsToken={yjsToken}
          user={user}
          editable
        />
      ) : (
        // Read-only context (VIEWER/COMMENTER origin access, or a non-editable
        // host): render the static snapshot — NEVER a live connection (§8).
        <AnyNotePlainEditor
          value={(data.content as JSONContent | null) ?? null}
          editable={false}
          onBlurSave={() => undefined}
        />
      )}
    </Box>
  )
}
