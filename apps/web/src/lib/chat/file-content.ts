import 'server-only'

import { extractTextFromFile, isInlineTextType, MAX_INLINE_FILE_BYTES } from '@repo/storage'
import type { StorageClient } from '@repo/storage'

export { MAX_INLINE_FILE_BYTES }
export const MAX_TOTAL_INLINE_BYTES = 512 * 1024

const PDF_MIME = 'application/pdf'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export type AttachmentFile = {
  id: string
  name: string
  ext: string
  mimeType: string
  fileSize: bigint
  path: string
}

export type ResolvedAttachment = {
  id: string
  name: string
  mime: string
  sizeBytes: number
  included: boolean
  content?: string
  reason?: string
}

function canInline(file: AttachmentFile): boolean {
  return (
    isInlineTextType(file.ext) ||
    file.mimeType === PDF_MIME ||
    file.mimeType === DOCX_MIME ||
    file.ext.toLowerCase() === 'pdf' ||
    file.ext.toLowerCase() === 'docx'
  )
}

async function readAll(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export async function resolveAttachmentContents(
  storage: StorageClient,
  files: AttachmentFile[],
): Promise<ResolvedAttachment[]> {
  let usedBytes = 0
  const out: ResolvedAttachment[] = []

  for (const file of files) {
    const base = {
      id: file.id,
      name: file.name,
      mime: file.mimeType,
      sizeBytes: Number(file.fileSize),
    }

    if (!canInline(file)) {
      out.push({
        ...base,
        included: false,
        reason: 'unsupported binary — use get_file_content',
      })
      continue
    }
    if (usedBytes >= MAX_TOTAL_INLINE_BYTES) {
      out.push({ ...base, included: false, reason: 'total inline budget exceeded' })
      continue
    }

    try {
      const bytes = await readAll(await storage.get(file.path))
      // Truncate at the per-file limit (a single large file is summarised to its
      // first MAX_INLINE_FILE_BYTES and still inlined). The total budget is a
      // separate, harder gate: if the per-file-capped text would not fit in the
      // remaining budget, exclude the whole file rather than slice it to a
      // misleading sliver of "complete" content.
      const text = await extractTextFromFile(bytes, file.mimeType, file.ext, MAX_INLINE_FILE_BYTES)
      const textBytes = Buffer.from(text, 'utf8').length
      if (textBytes > MAX_TOTAL_INLINE_BYTES - usedBytes) {
        out.push({ ...base, included: false, reason: 'total inline budget exceeded' })
        continue
      }
      usedBytes += textBytes
      out.push({ ...base, included: true, content: text })
    } catch (err) {
      console.error(`[chat] failed to read attachment ${file.id} (${file.name})`, err)
      out.push({ ...base, included: false, reason: 'extraction failed' })
    }
  }

  return out
}
