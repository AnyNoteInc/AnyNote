import {
  GotenbergTimeoutError,
  GotenbergUnreachableError,
  GotenbergUpstreamError,
} from './errors.ts'

const DEFAULT_TIMEOUT_MS = 30_000

function getEnv(key: string, fallback?: string): string {
  const v = process.env[key]
  if (v && v.length > 0) return v
  if (fallback !== undefined) return fallback
  throw new Error(`Missing required env: ${key}`)
}

/**
 * Конвертирует office-документ (doc/docx/xls/xlsx/ppt/pptx/odt/ods/odp/rtf) в
 * PDF через LibreOffice-роут Gotenberg. Расширение в `filename` обязательно —
 * по нему LibreOffice определяет входной формат.
 */
export async function officeToPdf(
  bytes: Uint8Array<ArrayBuffer>,
  filename: string,
): Promise<ReadableStream<Uint8Array>> {
  // Missing configuration surfaces as the same typed error as a downed
  // service — callers map it to a user-facing "PDF service unavailable"
  // instead of leaking a raw env error.
  const base = process.env.GOTENBERG_URL
  if (!base) throw new GotenbergUnreachableError('GOTENBERG_URL is not configured')
  const url = `${base}/forms/libreoffice/convert`
  const timeoutMs = Number(getEnv('GOTENBERG_TIMEOUT_MS', String(DEFAULT_TIMEOUT_MS)))

  const fd = new FormData()
  fd.append('files', new Blob([bytes]), filename)

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      body: fd,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    const name = (err as Error).name
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new GotenbergTimeoutError()
    }
    throw new GotenbergUnreachableError((err as Error).message)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new GotenbergUpstreamError(res.status, body)
  }
  if (!res.body) {
    throw new GotenbergUpstreamError(200, 'empty body')
  }
  return res.body
}
