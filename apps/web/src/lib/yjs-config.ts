'use client'

export const yjsUrl = process.env.NEXT_PUBLIC_YJS_URL ?? 'ws://localhost:1234'

export async function fetchYjsToken(): Promise<string> {
  const res = await fetch('/api/yjs/token', { method: 'POST', credentials: 'include' })
  if (!res.ok) throw new Error(`yjs token fetch failed: ${res.status}`)
  const data = (await res.json()) as { token: string }
  return data.token
}
