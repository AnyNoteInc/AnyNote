import FileUpload, {
  type StoredAsset,
  type UploadHandler as CodelessUploadHandler,
} from '@tiptap-codeless/extension-file-upload'

import type { UploadHandler } from '../types'

const inferKind = (mime: string): 'image' | 'video' | 'file' => {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  return 'file'
}

export const buildFileUpload = (uploadHandler: UploadHandler) => {
  const upload: CodelessUploadHandler = async (files) => {
    const assets: StoredAsset[] = await Promise.all(
      files.map(async (file): Promise<StoredAsset> => {
        const result = await uploadHandler({ blob: file, filename: file.name })
        return {
          kind: inferKind(file.type),
          url: result.src,
          name: file.name,
          mimeType: file.type,
          size: file.size,
        }
      }),
    )
    return { assets }
  }
  return FileUpload.configure({
    storageMode: 'custom',
    handlePaste: true,
    handleDrop: true,
    upload,
  })
}
