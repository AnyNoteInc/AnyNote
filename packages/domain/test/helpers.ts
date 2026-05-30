import { vi } from 'vitest'

import type { DeliveryScheduler } from '../src/reminders/reminders.ports.ts'
import type { UnitOfWork } from '../src/shared/unit-of-work.ts'

/**
 * A UoW whose `client()` returns the given delegate map (a partial Prisma client
 * of `vi.fn()` spies) and whose `transaction()` runs its callback inline.
 * The shared form used by the repository test suites.
 */
export function makeDelegateUow(
  delegates: Record<string, Record<string, ReturnType<typeof vi.fn>>>,
): UnitOfWork {
  const client = delegates as never
  return {
    client: () => client,
    transaction: async (fn) => fn(),
  }
}

/** A DeliveryScheduler whose rebuild/cancel are no-op spies. */
export function makeScheduler(): DeliveryScheduler & {
  rebuild: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
} {
  return { rebuild: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined) }
}
