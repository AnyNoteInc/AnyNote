'use client'

import { useEffectEvent, useMemo, useState } from 'react'

import type { ChatComposerAttachment } from '@repo/ui/components'

import type { DraftAttachmentSummary } from './chat-message-mappers'

type UploadResponse = {
  file: {
    id: string
    name: string
    mimeType: string
    fileSize: string
  }
}

export type DraftAttachment = ChatComposerAttachment & {
  fileId?: string
  uploadError?: string
  uploadedName?: string
  uploadedMimeType?: string
  uploadedFileSize?: string
}

export function useDraftAttachments(workspaceId: string) {
  const [attachments, setAttachments] = useState<DraftAttachment[]>([])
  const [error, setError] = useState<string | null>(null)

  const uploadAttachment = useEffectEvent(async (localId: string, file: File) => {
    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await fetch(`/api/files/upload?kind=attachment&workspaceId=${workspaceId}`, {
        method: 'POST',
        body: formData,
      })

      const payload = (await response.json().catch(() => null)) as
        | UploadResponse
        | { error?: string }
        | null
      if (!response.ok || !payload || !('file' in payload)) {
        throw new Error(
          payload && 'error' in payload && typeof payload.error === 'string'
            ? payload.error
            : 'Не удалось загрузить файл.',
        )
      }

      setAttachments((current) =>
        current.map((attachment) => {
          if (attachment.localId !== localId) {
            return attachment
          }

          return {
            ...attachment,
            status: 'uploaded',
            fileId: payload.file.id,
            uploadError: undefined,
            uploadedName: payload.file.name,
            uploadedMimeType: payload.file.mimeType,
            uploadedFileSize: payload.file.fileSize,
          }
        }),
      )
      setError(null)
    } catch (uploadError) {
      const message =
        uploadError instanceof Error ? uploadError.message : 'Не удалось загрузить файл.'

      setAttachments((current) =>
        current.map((attachment) => {
          if (attachment.localId !== localId) {
            return attachment
          }

          return {
            ...attachment,
            status: 'error',
            uploadError: message,
          }
        }),
      )
      setError(message)
    }
  })

  const syncComposerAttachments = useEffectEvent((nextAttachments: ChatComposerAttachment[]) => {
    const currentById = new Map(attachments.map((attachment) => [attachment.localId, attachment]))
    const newAttachments = nextAttachments.filter(
      (attachment) => !currentById.has(attachment.localId),
    )

    setAttachments(
      nextAttachments.map((attachment) => {
        const existing = currentById.get(attachment.localId)
        if (existing) {
          return {
            ...existing,
            file: attachment.file,
            previewUrl: attachment.previewUrl,
          }
        }

        return {
          ...attachment,
          status: 'uploading',
        }
      }),
    )

    if (nextAttachments.length === 0) {
      setError(null)
    }

    for (const attachment of newAttachments) {
      void uploadAttachment(attachment.localId, attachment.file)
    }
  })

  const removeAttachment = useEffectEvent((localId: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.localId !== localId))
    setError(null)
  })

  // Attach an already-uploaded file (e.g. a "recent file" picked from the
  // composer + menu) by its id, without re-uploading. We synthesize an empty
  // File only to satisfy the ChatDraftAttachment shape; the chip label and the
  // outgoing send payload both read the uploaded* fields, not file contents.
  const addUploaded = useEffectEvent(
    (uploaded: { fileId: string; name: string; mimeType?: string; fileSize: string }) => {
      setError(null)
      setAttachments((current) => {
        if (current.some((attachment) => attachment.fileId === uploaded.fileId)) {
          return current
        }
        const mimeType = uploaded.mimeType || 'application/octet-stream'
        const localId = `recent-${uploaded.fileId}`
        return [
          ...current,
          {
            localId,
            file: new File([], uploaded.name, { type: mimeType }),
            status: 'uploaded',
            fileId: uploaded.fileId,
            uploadedName: uploaded.name,
            uploadedMimeType: mimeType,
            uploadedFileSize: uploaded.fileSize,
          },
        ]
      })
    },
  )

  const clear = useEffectEvent(() => {
    setAttachments([])
    setError(null)
  })

  const uploadedAttachments = useMemo<DraftAttachmentSummary[]>(() => {
    return attachments
      .filter((attachment) => attachment.status === 'uploaded' && attachment.fileId)
      .map((attachment) => ({
        fileId: attachment.fileId!,
        name: attachment.uploadedName ?? attachment.file.name,
        mimeType:
          (attachment.uploadedMimeType ?? attachment.file.type) || 'application/octet-stream',
        fileSize: attachment.uploadedFileSize ?? attachment.file.size.toString(),
      }))
  }, [attachments])

  return {
    addUploaded,
    attachments,
    clear,
    error,
    hasFailedUploads: attachments.some((attachment) => attachment.status === 'error'),
    hasPendingUploads: attachments.some((attachment) => attachment.status === 'uploading'),
    removeAttachment,
    syncComposerAttachments,
    uploadedAttachments,
  }
}
