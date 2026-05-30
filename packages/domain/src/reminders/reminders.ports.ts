import type { Prisma } from '@repo/db'

import type { ReminderForRebuildDto } from './dto/reminders.dto.ts'

/**
 * Consumer-provided port: the domain calls this to schedule / cancel delivery
 * jobs without knowing anything about the scheduling implementation.
 *
 * The `client` parameter is always a live `Prisma.TransactionClient` because
 * `rebuild` and `cancel` are only ever called from inside `uow.transaction()`.
 */
export interface DeliveryScheduler {
  rebuild(client: Prisma.TransactionClient, r: ReminderForRebuildDto): Promise<void>
  cancel(client: Prisma.TransactionClient, reminderIds: string[], reason: string): Promise<void>
}
