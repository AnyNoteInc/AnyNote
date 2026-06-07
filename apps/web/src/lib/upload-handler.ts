'use client'

import type { UploadHandler } from '@repo/editor'

export type AttachFn = (fileId: string) => Promise<void>

export function createUploadHandler(args: { attachToPage: AttachFn }): UploadHandler {
  return async ({ blob, filename }) => {
    const fd = new FormData()
    fd.append('file', blob, filename)
    const res = await fetch(`/api/files/upload?kind=attachment`, {
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
