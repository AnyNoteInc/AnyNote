/**
 * Contract limits — exported so the public developer docs (and their
 * drift-guard tests) read the same values the runtime enforces.
 */
export const TELEGRAM_LIMITS = {
  /** Max event subscriptions per bot connection (enforced in the tRPC router). */
  maxSubscriptionsPerConnection: 50,
  /** One-time /link code TTL: 15 minutes. */
  linkCodeTtlMs: 15 * 60_000,
  /** Human-typed one-time /link code length. */
  linkCodeLength: 8,
  /** Cap on what a /search query passes to Prisma `contains`. */
  searchQueryMax: 200,
} as const
