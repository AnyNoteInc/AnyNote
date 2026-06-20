type FetchFn = (
  input: string,
  init?: { method?: string; signal?: AbortSignal },
) => Promise<Response>

export async function pingHealth(serverUrl: string, fetchFn: FetchFn): Promise<boolean> {
  try {
    const res = await fetchFn(`${serverUrl}/api/health`, { method: 'GET' })
    if (!res.ok) return false
    const body = (await res.json()) as { status?: string }
    return body.status === 'ok'
  } catch {
    return false
  }
}
