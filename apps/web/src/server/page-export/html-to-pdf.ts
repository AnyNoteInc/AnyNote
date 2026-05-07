import {
  GotenbergTimeoutError,
  GotenbergUnreachableError,
  GotenbergUpstreamError,
} from './errors'

const DEFAULT_TIMEOUT_MS = 30_000

function getEnv(key: string, fallback?: string): string {
  const v = process.env[key]
  if (v && v.length > 0) return v
  if (fallback !== undefined) return fallback
  throw new Error(`Missing required env: ${key}`)
}

export async function htmlToPdf(html: string): Promise<ReadableStream<Uint8Array>> {
  const url = `${getEnv('GOTENBERG_URL')}/forms/chromium/convert/html`
  const timeoutMs = Number(getEnv('GOTENBERG_TIMEOUT_MS', String(DEFAULT_TIMEOUT_MS)))

  const fd = new FormData()
  fd.append('files', new Blob([html], { type: 'text/html' }), 'index.html')
  fd.append('paperWidth', '8.27')
  fd.append('paperHeight', '11.69')
  fd.append('marginTop', '0.7')
  fd.append('marginBottom', '0.7')
  fd.append('marginLeft', '0.7')
  fd.append('marginRight', '0.7')
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
