import { z } from 'zod'
import type { ReminderAudience } from '@repo/db'

// ── Input schemas ──────────────────────────────────────────────────────────

export const createReminderInput = z.object({
  pageId: z.string().uuid(),
  dueAt: z.date(),
  offsets: z.array(z.number().int().min(0).max(525_600)).max(20).default([]),
  audience: z.enum(['ME', 'WORKSPACE', 'LIST']).default('ME'),
  label: z.string().max(200).nullable().optional(),
})
export type CreateReminderInput = z.infer<typeof createReminderInput>

export const moveReminderInput = z.object({
  reminderId: z.string().uuid(),
  dueAt: z.date().optional(),
  shift: z
    .object({
      days: z.number().int().optional(),
      hours: z.number().int().optional(),
      minutes: z.number().int().optional(),
    })
    .optional(),
})
export type MoveReminderInput = z.infer<typeof moveReminderInput>

export const deleteReminderInput = z.object({
  reminderId: z.string().uuid().optional(),
  reminderIds: z.array(z.string().uuid()).optional(),
  all: z.boolean().optional(),
  pageId: z.string().uuid().optional(),
})
export type DeleteReminderInput = z.infer<typeof deleteReminderInput>

export const completeReminderInput = z.object({
  reminderId: z.string().uuid(),
})
export type CompleteReminderInput = z.infer<typeof completeReminderInput>

export const reminderSyncItemSchema = z.object({
  id: z.string().uuid(),
  dueAt: z.string().datetime(),
  offsets: z.array(z.number().int().min(0).max(525_600)).max(20),
  audience: z.enum(['ME', 'WORKSPACE', 'LIST']),
  label: z.string().max(200).nullable(),
  recipients: z.array(z.string().uuid()).max(100),
  doneAt: z.string().datetime().nullable(),
})
export type ReminderSyncItem = z.infer<typeof reminderSyncItemSchema>

export const syncRemindersInput = z.object({
  pageId: z.string().uuid(),
  reminders: z.array(reminderSyncItemSchema).max(500),
})
export type SyncRemindersInput = z.infer<typeof syncRemindersInput>

// ── Output DTOs ────────────────────────────────────────────────────────────

export interface ReminderForRebuildDto {
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
