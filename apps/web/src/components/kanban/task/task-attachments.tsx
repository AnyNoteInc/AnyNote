'use client'

import { useRef, useState } from 'react'
import {
  Box,
  Button,
  CloseIcon,
  IconButton,
  Stack,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

interface TaskAttachmentsProps {
  readonly pageId: string
  readonly workspaceId: string
  readonly taskId: string
  readonly currentUserId: string
}

interface AttachmentRow {
  taskId: string
  fileId: string
  uploadedById: string
  createdAt: Date | string
  file: { id: string; name: string; mimeType: string; fileSize: bigint }
  uploadedBy: {
    id: string
    firstName: string | null
    lastName: string | null
    email: string
  }
}

function formatBytes(n: bigint | number): string {
  const size = typeof n === 'bigint' ? Number(n) : n
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function TaskAttachments({
  pageId,
  workspaceId,
  taskId,
  currentUserId,
}: TaskAttachmentsProps) {
  const utils = trpc.useUtils()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data } = trpc.kanban.attachment.list.useQuery({ pageId, taskId })
  const attachments: AttachmentRow[] = data ?? []

  const invalidate = () => utils.kanban.attachment.list.invalidate({ pageId, taskId })
  const attach = trpc.kanban.attachment.attach.useMutation({ onSuccess: invalidate })
  const detach = trpc.kanban.attachment.detach.useMutation({ onSuccess: invalidate })

  async function upload(file: File) {
    setBusy(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(
        `/api/files/upload?kind=attachment&workspaceId=${workspaceId}`,
        { method: 'POST', body: fd, credentials: 'include' },
      )
      if (!res.ok) {
        setError(`Не удалось загрузить файл (${res.status})`)
        return
      }
      const json = (await res.json()) as { file: { id: string } }
      await attach.mutateAsync({ pageId, taskId, fileId: json.file.id })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle2">Вложения</Typography>

      <Stack spacing={0.75}>
        {attachments.map((a) => (
          <Stack
            key={a.fileId}
            direction="row"
            alignItems="center"
            spacing={1}
            sx={{
              p: 1,
              borderRadius: 1,
              bgcolor: 'action.hover',
            }}
          >
            <Box sx={{ flex: 1 }}>
              <a
                href={`/api/files/${a.file.id}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'inherit', textDecoration: 'underline' }}
              >
                {a.file.name}
              </a>
              <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                {formatBytes(a.file.fileSize)} · {a.file.mimeType}
              </Typography>
            </Box>
            {a.uploadedById === currentUserId ? (
              <IconButton
                size="small"
                onClick={() => detach.mutate({ pageId, taskId, fileId: a.fileId })}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            ) : null}
          </Stack>
        ))}
        {attachments.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            Вложений пока нет.
          </Typography>
        ) : null}
      </Stack>

      <Stack direction="row" spacing={1} alignItems="center">
        <input
          ref={inputRef}
          type="file"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void upload(file)
            e.target.value = ''
          }}
        />
        <Button
          size="small"
          variant="outlined"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? 'Загрузка…' : 'Прикрепить файл'}
        </Button>
        {error ? (
          <Typography variant="caption" color="error">
            {error}
          </Typography>
        ) : null}
      </Stack>
    </Stack>
  )
}
