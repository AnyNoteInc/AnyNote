/**
 * Numeric contract constants — exported so the public developer docs (and
 * their drift-guard tests) read the same values the runtime uses.
 */

/** Retry backoff base: 60s, doubled per attempt (60s, 120s, 240s, …). */
export const BACKOFF_BASE_MS = 60_000

/** Retry backoff ceiling: 30 minutes. */
export const BACKOFF_CAP_MS = 30 * 60_000

/** Consecutive terminal failures before a subscription is auto-disabled (FAILED). */
export const DEFAULT_AUTO_DISABLE_THRESHOLD = 10

/** The verification echo must appear within the first 4KB of the response body. */
export const CHALLENGE_ECHO_SCAN_CHARS = 4096

/** Hard cap on webhook subscriptions per workspace (enforced in the tRPC router). */
export const MAX_WEBHOOK_SUBSCRIPTIONS_PER_WORKSPACE = 20
