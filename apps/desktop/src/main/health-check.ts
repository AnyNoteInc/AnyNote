type FetchFn = (
  input: string,
  init?: { method?: string; signal?: AbortSignal },
) => Promise<Response>

export async function pingHealth(
  serverUrl: string,
  fetchFn: FetchFn,
  timeoutMs = 8000,
): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchFn(`${serverUrl}/api/health`, {
      method: 'GET',
      signal: controller.signal,
    })
    if (!res.ok) return false
    const body = (await res.json()) as { status?: string }
    return body.status === 'ok'
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
