import type { Prisma, ReminderAudience } from '@repo/db'

export interface ReminderForRebuild {
  id: string
  pageId: string
  workspaceId: string
  createdById: string | null
  dueAt: Date
  offsets: number[]
  audience: ReminderAudience
  label: string | null
  recipients: string[]
  doneAt: Date | null
}

export interface DeliveryScheduler {
  rebuild(tx: Prisma.TransactionClient, r: ReminderForRebuild): Promise<void>
  cancel(tx: Prisma.TransactionClient, reminderIds: string[], reason: string): Promise<void>
}
