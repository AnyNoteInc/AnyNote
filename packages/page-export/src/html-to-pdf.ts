import { GotenbergTimeoutError, GotenbergUnreachableError, GotenbergUpstreamError } from './errors.ts'

const DEFAULT_TIMEOUT_MS = 30_000
const A4_PAPER_WIDTH_IN = '8.27'
const A4_PAPER_HEIGHT_IN = '11.69'
const A4_STANDARD_MARGIN_IN = '0.79'

function getEnv(key: string, fallback?: string): string {
  const v = process.env[key]
  if (v && v.length > 0) return v
  if (fallback !== undefined) return fallback
  throw new Error(`Missing required env: ${key}`)
}

export async function htmlToPdf(html: string): Promise<ReadableStream<Uint8Array>> {
  // Missing configuration surfaces as the same typed error as a downed
  // service — callers (web export route, engines exportPageToPdf) map it to a
  // user-facing "PDF service unavailable" instead of leaking a raw env error.
  const base = process.env.GOTENBERG_URL
  if (!base) throw new GotenbergUnreachableError('GOTENBERG_URL is not configured')
  const url = `${base}/forms/chromium/convert/html`
  const timeoutMs = Number(getEnv('GOTENBERG_TIMEOUT_MS', String(DEFAULT_TIMEOUT_MS)))

  const fd = new FormData()
  fd.append('files', new Blob([html], { type: 'text/html' }), 'index.html')
  fd.append('paperWidth', A4_PAPER_WIDTH_IN)
  fd.append('paperHeight', A4_PAPER_HEIGHT_IN)
  fd.append('marginTop', A4_STANDARD_MARGIN_IN)
  fd.append('marginBottom', A4_STANDARD_MARGIN_IN)
  fd.append('marginLeft', A4_STANDARD_MARGIN_IN)
  fd.append('marginRight', A4_STANDARD_MARGIN_IN)
  fd.append('printBackground', 'true')

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
