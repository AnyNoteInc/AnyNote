export async function waitUntil(
  fn: () => Promise<boolean>,
  opts: { timeout: number; pollMs?: number; label?: string } = { timeout: 30_000 },
): Promise<void> {
  const { timeout, pollMs = 500, label = "condition" } = opts
  const start = Date.now()
  let lastErr: unknown
  while (Date.now() - start < timeout) {
    try {
      if (await fn()) return
    } catch (err) {
      lastErr = err
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  throw new Error(
    `waitUntil timeout (${timeout}ms) for ${label}${lastErr ? ": " + String(lastErr) : ""}`,
  )
}
