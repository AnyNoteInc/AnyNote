'use client'

import { useRef, useState } from 'react'
import {
  AttachFileIcon,
  Box,
  Chip,
  CircularProgress,
  CloseIcon,
  IconButton,
  Stack,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { useCellUpdate } from './use-optimistic-cell'

interface FileCellProps {
  readonly pageId: string
  readonly rowId: string
  readonly propertyId: string
  readonly value: unknown
  readonly editable?: boolean
}

/**
 * File cell. The stored value is a `File` id. When empty, an upload button posts
 * to `/api/files/upload?kind=attachment` (the same path as task attachments) and
 * commits the returned file id. When set, the file name links to `/api/files/[id]`
 * (metadata via `file.getById`), with an image thumbnail when the mime is an image
 * and a remove affordance (commits null). Existence of the id is re-checked
 * server-side by `updateCellValue` (tRPC layer) on write.
 */
export function FileCell({ pageId, rowId, propertyId, value, editable = true }: FileCellProps) {
  const { commit } = useCellUpdate(pageId)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fileId = typeof value === 'string' && value !== '' ? value : null

  const { data: file } = trpc.file.getById.useQuery(
    { id: fileId ?? '' },
    { enabled: Boolean(fileId), retry: false },
  )

  async function upload(picked: File) {
    setBusy(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', picked)
      const res = await fetch('/api/files/upload?kind=attachment', {
        method: 'POST',
        body: fd,
        credentials: 'include',
      })
      if (!res.ok) {
        setError(`Не удалось загрузить файл (${res.status})`)
        return
      }
      const json = (await res.json()) as { file: { id: string } }
      commit(rowId, propertyId, json.file.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const isImage = file?.mimeType?.startsWith('image/') ?? false

  if (!fileId) {
    if (!editable) return <span style={{ color: 'rgba(0,0,0,0.4)', fontSize: 13 }}>—</span>
    return (
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <Chip
          size="small"
          variant="outlined"
          icon={busy ? <CircularProgress size={12} /> : <AttachFileIcon />}
          label={busy ? 'Загрузка…' : 'Загрузить'}
          onClick={() => !busy && inputRef.current?.click()}
          sx={{ cursor: busy ? 'wait' : 'pointer' }}
        />
        <input
          ref={inputRef}
          type="file"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void upload(f)
            e.target.value = ''
          }}
        />
        {error ? (
          <Typography variant="caption" color="error">
            {error}
          </Typography>
        ) : null}
      </Stack>
    )
  }

  return (
    <Stack direction="row" spacing={0.75} sx={{ minWidth: 0, alignItems: 'center' }}>
      {isImage ? (
        <Box
          component="a"
          href={`/api/files/${fileId}`}
          target="_blank"
          rel="noopener noreferrer"
          sx={{ display: 'inline-flex', flex: '0 0 auto' }}
          onClick={(e) => e.stopPropagation()}
        >
          <Box
            component="img"
            src={`/api/files/${fileId}`}
            alt={file?.name ?? ''}
            sx={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 0.5, display: 'block' }}
          />
        </Box>
      ) : (
        <AttachFileIcon fontSize="small" sx={{ color: 'text.secondary', flex: '0 0 auto' }} />
      )}
      <Box
        component="a"
        href={`/api/files/${fileId}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        sx={{
          fontSize: 13,
          color: 'primary.main',
          textDecoration: 'underline',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
        }}
        title={file?.name ?? fileId}
      >
        {file?.name ?? 'Файл'}
      </Box>
      {editable ? (
        <IconButton
          size="small"
          aria-label="Удалить файл"
          onClick={() => commit(rowId, propertyId, null)}
          sx={{ flex: '0 0 auto' }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      ) : null}
    </Stack>
  )
}
