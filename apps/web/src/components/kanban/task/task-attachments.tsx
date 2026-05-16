'use client'

import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { Box, CloseIcon, IconButton, Stack, Typography } from '@repo/ui/components'

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
  file: { id: string; name: string; mimeType: string; fileSize: string }
  uploadedBy: {
    id: string
    firstName: string | null
    lastName: string | null
    email: string
  }
}

function formatBytes(input: string | number): string {
  const size = typeof input === 'string' ? Number(input) : input
  if (!Number.isFinite(size)) return ''
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
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data } = trpc.kanban.attachment.list.useQuery({ pageId, taskId })
  const attachments: AttachmentRow[] = data ?? []

  const invalidate = () => utils.kanban.attachment.list.invalidate({ pageId, taskId })
  const attach = trpc.kanban.attachment.attach.useMutation({ onSuccess: invalidate })
  const detach = trpc.kanban.attachment.detach.useMutation({ onSuccess: invalidate })

  async function uploadFile(file: File) {
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(
        `/api/files/upload?kind=attachment&workspaceId=${workspaceId}`,
        { method: 'POST', body: fd, credentials: 'include' },
      )
      if (!res.ok) {
        setError(`Не удалось загрузить «${file.name}» (${res.status})`)
        return
      }
      const json = (await res.json()) as { file: { id: string } }
      await attach.mutateAsync({ pageId, taskId, fileId: json.file.id })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function uploadAll(files: FileList | File[]) {
    setBusy(true)
    try {
      for (const file of Array.from(files)) {
        await uploadFile(file)
      }
    } finally {
      setBusy(false)
    }
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault()
      setDragOver(true)
    }
  }
  function handleDragLeave() {
    setDragOver(false)
  }
  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    const files = e.dataTransfer.files
    if (files.length > 0) await uploadAll(files)
  }

  function openPicker() {
    if (!busy) inputRef.current?.click()
  }
  function handleKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openPicker()
    }
  }

  const emptyHint = busy ? 'Загрузка…' : 'Перетащите файлы сюда или нажмите, чтобы выбрать'

  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">Вложения</Typography>

      <Box
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={openPicker}
        onKeyDown={handleKey}
        role="button"
        tabIndex={0}
        aria-label="Загрузить файлы"
        sx={{
          p: 1.5,
          border: 2,
          borderStyle: 'dashed',
          borderColor: dragOver ? 'primary.main' : 'divider',
          borderRadius: 1,
          bgcolor: dragOver ? 'action.hover' : 'background.paper',
          transition: 'border-color 120ms, background-color 120ms',
          cursor: busy ? 'wait' : 'pointer',
          '&:hover': { borderColor: 'primary.main' },
          '&:focus-visible': {
            outline: 2,
            outlineColor: 'primary.main',
            outlineOffset: 2,
          },
        }}
      >
        <Stack spacing={0.75}>
          {attachments.map((a) => (
            <Stack
              key={a.fileId}
              direction="row"
              alignItems="center"
              spacing={1}
              sx={{ p: 0.5, borderRadius: 0.5, bgcolor: 'action.hover' }}
              onClick={(e) => e.stopPropagation()}
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
                  onClick={(e) => {
                    e.stopPropagation()
                    detach.mutate({ pageId, taskId, fileId: a.fileId })
                  }}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              ) : null}
            </Stack>
          ))}
          <Typography variant="caption" color="text.secondary" align="center">
            {emptyHint}
          </Typography>
        </Stack>
      </Box>

      <input
        ref={inputRef}
        type="file"
        hidden
        multiple
        onChange={(e) => {
          const files = e.target.files
          if (files && files.length > 0) void uploadAll(files)
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
