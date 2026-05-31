export const MAX_INLINE_FILE_BYTES = 256 * 1024

const TEXT_EXTENSIONS = new Set([
  'md',
  'txt',
  'csv',
  'json',
  'yaml',
  'yml',
  'xml',
  'html',
  'css',
  'js',
  'ts',
  'tsx',
  'jsx',
  'py',
  'go',
  'java',
  'rb',
  'php',
  'rs',
  'c',
  'cpp',
  'h',
  'sql',
  'log',
])

const PDF_MIME = 'application/pdf'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export function isInlineTextType(ext: string): boolean {
  return TEXT_EXTENSIONS.has(ext.toLowerCase())
}

function truncateUtf8(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, 'utf8')
  if (buf.length <= maxBytes) return text
  // Back off to a UTF-8 character boundary so we never split a multibyte
  // sequence (which would emit U+FFFD and could overshoot maxBytes).
  let end = maxBytes
  // UTF-8 continuation bytes match 0b10xxxxxx; step back over them and the
  // lead byte of the partial character at the boundary.
  while (end > 0 && ((buf[end] ?? 0) & 0xc0) === 0x80) end--
  return buf.subarray(0, end).toString('utf8')
}

export async function extractTextFromFile(
  bytes: Buffer,
  mime: string,
  ext: string,
  maxBytes: number,
): Promise<string> {
  if (mime === PDF_MIME || ext.toLowerCase() === 'pdf') {
    const { extractText, getDocumentProxy } = await import('unpdf')
    const doc = await getDocumentProxy(new Uint8Array(bytes))
    const { text } = await extractText(doc, { mergePages: true })
    // `mergePages: true` types `text` as a string, but guard the array shape
    // too so a future unpdf version that returns string[] still works.
    const merged: string = Array.isArray(text) ? text.join('\n') : text
    return truncateUtf8(merged, maxBytes)
  }
  if (mime === DOCX_MIME || ext.toLowerCase() === 'docx') {
    const mammoth = await import('mammoth')
    const { value } = await mammoth.extractRawText({ buffer: bytes })
    return truncateUtf8(value, maxBytes)
  }
  if (isInlineTextType(ext)) {
    return truncateUtf8(bytes.toString('utf8'), maxBytes)
  }
  throw new Error(`Unsupported file type for text extraction: ${mime} (.${ext})`)
}
