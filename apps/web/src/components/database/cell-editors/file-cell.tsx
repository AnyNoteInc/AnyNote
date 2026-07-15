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

function normalizeFileIds(value: unknown): string[] {
  const raw =
    typeof value === 'string'
      ? [value]
      : Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : []
  return [...new Set(raw.filter((fileId) => fileId.trim() !== ''))]
}

function FileItem({
  fileId,
  editable,
  onRemove,
}: {
  fileId: string
  editable: boolean
  onRemove: () => void
}) {
  const { data: file } = trpc.file.getById.useQuery({ id: fileId }, { enabled: true, retry: false })
  const isImage = file?.mimeType?.startsWith('image/') ?? false
  const displayName = file?.name ?? 'Файл'

  return (
    <Stack direction="row" spacing={0.5} sx={{ minWidth: 0, alignItems: 'center' }}>
      {isImage ? (
        <Box
          component="a"
          href={`/api/files/${fileId}`}
          target="_blank"
          rel="noopener noreferrer"
          sx={{ display: 'inline-flex', flex: '0 0 auto' }}
          onClick={(event) => event.stopPropagation()}
        >
          <Box
            component="img"
            src={`/api/files/${fileId}`}
            alt={displayName}
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
        onClick={(event) => event.stopPropagation()}
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
        {displayName}
      </Box>
      {editable ? (
        <IconButton
          size="small"
          aria-label={`Удалить файл ${file?.name ?? fileId}`}
          onClick={onRemove}
          sx={{ flex: '0 0 auto' }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      ) : null}
    </Stack>
  )
}

/** Multi-file cell with legacy scalar compatibility at the render boundary. */
export function FileCell({ pageId, rowId, propertyId, value, editable = true }: FileCellProps) {
  const { commit } = useCellUpdate(pageId)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileIds = normalizeFileIds(value)

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
      if (!fileIds.includes(json.file.id)) {
        commit(rowId, propertyId, [...fileIds, json.file.id])
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  if (fileIds.length === 0 && !editable) {
    return <span style={{ color: 'rgba(0,0,0,0.4)', fontSize: 13 }}>—</span>
  }

  return (
    <Stack
      direction="row"
      spacing={0.75}
      useFlexGap
      sx={{ minWidth: 0, alignItems: 'center', flexWrap: 'wrap' }}
    >
      {fileIds.map((fileId) => (
        <FileItem
          key={fileId}
          fileId={fileId}
          editable={editable}
          onRemove={() =>
            commit(
              rowId,
              propertyId,
              fileIds.filter((candidate) => candidate !== fileId),
            )
          }
        />
      ))}
      {editable ? (
        <>
          <Chip
            size="small"
            variant="outlined"
            icon={busy ? <CircularProgress size={12} /> : <AttachFileIcon />}
            label={busy ? 'Загрузка…' : fileIds.length > 0 ? 'Добавить' : 'Загрузить'}
            onClick={() => !busy && inputRef.current?.click()}
            sx={{ cursor: busy ? 'wait' : 'pointer' }}
          />
          <input
            ref={inputRef}
            type="file"
            hidden
            aria-label="Добавить файл"
            onChange={(event) => {
              const picked = event.target.files?.[0]
              if (picked) void upload(picked)
              event.target.value = ''
            }}
          />
        </>
      ) : null}
      {error ? (
        <Typography variant="caption" color="error">
          {error}
        </Typography>
      ) : null}
    </Stack>
  )
}
