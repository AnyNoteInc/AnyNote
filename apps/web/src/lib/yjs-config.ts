'use client'

const DEV_FALLBACK = 'ws://localhost:1234'

// NEXT_PUBLIC_YJS_URL is inlined at build time, but prod images bake a dev
// placeholder; on HTTPS pages we route through Traefik at /ws instead.
export function resolveYjsUrl(): string {
  const baked = process.env.NEXT_PUBLIC_YJS_URL ?? ''

  if (globalThis.window === undefined) {
    return baked || DEV_FALLBACK
  }

  const { protocol, host } = globalThis.location
  if (protocol === 'https:' && !baked.startsWith('wss://')) {
    return `wss://${host}/ws`
  }

  return baked || DEV_FALLBACK
}

export async function fetchYjsToken(): Promise<string> {
  const res = await fetch('/api/yjs/token', { method: 'POST', credentials: 'include' })
  if (!res.ok) throw new Error(`yjs token fetch failed: ${res.status}`)
  const data = (await res.json()) as { token: string }
  return data.token
}
