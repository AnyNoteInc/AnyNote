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
    // For plain-text files the extracted text never exceeds the raw bytes, so an
    // over-cap fileSize already guarantees exclusion — skip the storage download
    // and decode entirely. (PDF/DOCX extract far less text than their byte size,
    // so they must still be read before we can judge the inlined length.)
    if (isInlineTextType(file.ext) && Number(file.fileSize) > MAX_INLINE_FILE_BYTES) {
      out.push({ ...base, included: false, reason: 'too large to inline — use get_file_content' })
      continue
    }

    try {
      const bytes = await readAll(await storage.get(file.path))
      // Extract one byte past the per-file cap so we can tell a file that fits
      // exactly from one that is larger. We never inline a *truncated* file:
      // silently feeding the model the first MAX_INLINE_FILE_BYTES (with no
      // truncation marker) makes it summarise an incomplete document and never
      // reach for get_file_content. If the text exceeds the per-file cap, or
      // would not fit in the remaining total budget, exclude it and let the
      // agent read the whole file via the get_file_content tool.
      const text = await extractTextFromFile(
        bytes,
        file.mimeType,
        file.ext,
        MAX_INLINE_FILE_BYTES + 1,
      )
      const textBytes = Buffer.from(text, 'utf8').length
      if (textBytes > MAX_INLINE_FILE_BYTES) {
        out.push({ ...base, included: false, reason: 'too large to inline — use get_file_content' })
        continue
      }
      if (textBytes > MAX_TOTAL_INLINE_BYTES - usedBytes) {
        out.push({
          ...base,
          included: false,
          reason: 'total inline budget exceeded — use get_file_content',
        })
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
