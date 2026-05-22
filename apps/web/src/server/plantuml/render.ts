import plantumlEncoder from 'plantuml-encoder'

import { PlantumlTimeoutError, PlantumlUnreachableError, PlantumlUpstreamError } from './errors'

const DEFAULT_TIMEOUT_MS = 15_000

function getEnv(key: string, fallback?: string): string {
  const v = process.env[key]
  if (v && v.length > 0) return v
  if (fallback !== undefined) return fallback
  throw new Error(`Missing required env: ${key}`)
}

/**
 * Render PlantUML source to an SVG string via the private plantuml-server. The
 * source is encoded into the URL path (deflate + PlantUML base64). PlantUML
 * returns its own error *diagram* (an SVG, usually HTTP 400) for invalid input —
 * we return that SVG so the user sees the rendered error. Only network failures,
 * 5xx, and non-SVG 4xx responses surface as errors.
 */
export async function renderPlantumlSvg(source: string): Promise<string> {
  const base = getEnv('PLANTUML_URL')
  const timeoutMs = Number(getEnv('PLANTUML_TIMEOUT_MS', String(DEFAULT_TIMEOUT_MS)))
  const encoded = plantumlEncoder.encode(source)
  const url = `${base}/svg/${encoded}`

  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    const name = (err as Error).name
    if (name === 'TimeoutError' || name === 'AbortError') throw new PlantumlTimeoutError()
    throw new PlantumlUnreachableError((err as Error).message)
  }

  const body = await res.text()
  const looksLikeSvg = body.includes('<svg')
  if (res.ok || (res.status >= 400 && res.status < 500 && looksLikeSvg)) {
    if (!looksLikeSvg) throw new PlantumlUpstreamError(res.status, body.slice(0, 500))
    return body
  }
  throw new PlantumlUpstreamError(res.status, body.slice(0, 500))
}
