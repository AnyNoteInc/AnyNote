/**
 * Per-(user, workspace) sliding-window limiter for inline AI (spec §3.1 step 4,
 * §7 invariant 7). Mirrors the in-memory limiter in
 * `bookmark/preview/handler.ts`, but keyed by user+workspace instead of IP —
 * inline AI is always authenticated, so the budget belongs to the actor.
 *
 * Single-instance only (documented in spec §10): a shared store is an operator
 * concern, same as the existing per-IP limiters.
 */

export const INLINE_AI_RATE_LIMIT_MAX = 10
export const INLINE_AI_RATE_LIMIT_WINDOW_MS = 60_000

const hits = new Map<string, number[]>()

export type InlineAiRateLimitKey = { userId: string; workspaceId: string }

/**
 * Records a hit and returns whether the caller is over the per-window cap.
 * `true` ⇒ rate-limited (the hit is NOT counted so a blocked caller can't push
 * the window forward indefinitely).
 */
export function isInlineAiRateLimited(key: InlineAiRateLimitKey): boolean {
  const k = `${key.userId}:${key.workspaceId}`
  const now = Date.now()
  const cutoff = now - INLINE_AI_RATE_LIMIT_WINDOW_MS
  const recent = (hits.get(k) ?? []).filter((ts) => ts > cutoff)
  if (recent.length >= INLINE_AI_RATE_LIMIT_MAX) {
    hits.set(k, recent)
    return true
  }
  recent.push(now)
  hits.set(k, recent)
  return false
}

/** Test-only: clear all counters between cases. */
export function __resetInlineAiRateLimit(): void {
  hits.clear()
}
