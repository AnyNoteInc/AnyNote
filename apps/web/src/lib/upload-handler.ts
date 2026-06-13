'use client'

import type { UploadHandler } from '@repo/editor'

import type { UploadKind } from '@/lib/file-validation'

export type AttachFn = (fileId: string) => Promise<void>

/**
 * The upload kind for a blob's MIME type. Video/audio go to the quota-counted
 * `media` kind (200MB, magic-byte sniffed); images stay `attachment` (they flow
 * through the image-paste path) and everything else is a plain attachment.
 */
export function kindFor(mimeType: string): UploadKind {
  if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) return 'media'
  return 'attachment'
}

export function createUploadHandler(args: { attachToPage: AttachFn }): UploadHandler {
  return async ({ blob, filename }) => {
    const fd = new FormData()
    fd.append('file', blob, filename)
    const kind = kindFor(blob.type)
    const res = await fetch(`/api/files/upload?kind=${kind}`, {
      method: 'POST',
      body: fd,
      credentials: 'include',
    })
    if (!res.ok) throw new Error(`upload failed: ${res.status}`)
    const data = (await res.json()) as { file: { id: string } }
    await args.attachToPage(data.file.id)
    return { id: data.file.id, src: `/api/files/${data.file.id}` }
  }
}
