function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null
}

export interface VersionedMigration {
  from: number
  migrate(input: Record<string, unknown>): Record<string, unknown>
}

/**
 * Registered in ascending order. Each migration consumes `from: N` and must
 * produce an object with `version: N + 1`. Empty today — kept as the
 * extension point so future schema changes don't require new transforms.
 */
const migrations: VersionedMigration[] = []

export function migrate(input: unknown): unknown {
  if (!isRecord(input)) return input
  let current: Record<string, unknown> = input
  let guard = 0
  while (guard++ < 64) {
    const version = typeof current.version === "number" ? current.version : 0
    const m = migrations.find((x) => x.from === version)
    if (!m) break
    const next = m.migrate(current)
    if (next === current) break
    current = next
  }
  return current
}
