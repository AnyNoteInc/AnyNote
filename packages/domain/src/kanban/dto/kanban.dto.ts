import { z } from 'zod'

// ── dateInput (moved from helpers.ts) ────────────────────────────────────────

export const dateInput = z
  .preprocess((v) => {
    if (v === null || v === undefined) return v
    if (v instanceof Date) return v
    if (typeof v === 'string') {
      const parsed = new Date(v)
      return Number.isNaN(parsed.getTime()) ? v : parsed
    }
    return v
  }, z.date().nullable())
  .optional()

// ── Input schemas ─────────────────────────────────────────────────────────────

export const createTaskInput = z.object({
  pageId: z.string().uuid(),
  columnId: z.string().uuid().optional(),
  typeId: z.string().uuid().optional(),
  priorityId: z.string().uuid().optional(),
  sprintId: z.string().uuid().optional(),
  title: z.string().min(1).max(500),
})
export type CreateTaskInput = z.infer<typeof createTaskInput>

export const updateTaskInput = z.object({
  pageId: z.string().uuid(),
  id: z.string().uuid(),
  title: z.string().min(1).max(500).optional(),
  description: z.unknown().optional(),
  startDate: dateInput,
  dueDate: dateInput,
  actualDate: dateInput,
  typeId: z.string().uuid().nullable().optional(),
  priorityId: z.string().uuid().nullable().optional(),
  sprintId: z.string().uuid().nullable().optional(),
  sprintPosition: z.number().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
})
export type UpdateTaskInput = z.infer<typeof updateTaskInput>

export const moveTaskInput = z.object({
  pageId: z.string().uuid(),
  id: z.string().uuid(),
  targetColumnId: z.string().uuid(),
  beforeId: z.string().uuid().nullable(),
  afterId: z.string().uuid().nullable(),
})
export type MoveTaskInput = z.infer<typeof moveTaskInput>

export const setTaskAssigneesInput = z.object({
  pageId: z.string().uuid(),
  id: z.string().uuid(),
  participantIds: z.array(z.string().uuid()),
  userIdsToMirror: z.array(z.string().uuid()),
})
export type SetTaskAssigneesInput = z.infer<typeof setTaskAssigneesInput>

export const createParticipantInput = z.object({
  workspaceId: z.string().uuid(),
  fullName: z.string().min(1).max(64),
  company: z.string().max(64).optional(),
})
export type CreateParticipantInput = z.infer<typeof createParticipantInput>

export const updateParticipantInput = z.object({
  workspaceId: z.string().uuid(),
  id: z.string().uuid(),
  fullName: z.string().min(1).max(64),
  company: z.string().max(64).nullable().optional(),
})
export type UpdateParticipantInput = z.infer<typeof updateParticipantInput>

export const participantIdInput = z.object({
  workspaceId: z.string().uuid(),
  id: z.string().uuid(),
})
export type ParticipantIdInput = z.infer<typeof participantIdInput>

export const listParticipantsInput = z.object({
  workspaceId: z.string().uuid(),
})
export type ListParticipantsInput = z.infer<typeof listParticipantsInput>

export const taskIdInput = z.object({ pageId: z.string().uuid(), id: z.string().uuid() })
export type TaskIdInput = z.infer<typeof taskIdInput>

export const createSprintInput = z.object({
  pageId: z.string().uuid(),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  startDate: dateInput,
  endDate: dateInput,
})
export type CreateSprintInput = z.infer<typeof createSprintInput>

export const sprintIdInput = z.object({ pageId: z.string().uuid(), id: z.string().uuid() })
export type SprintIdInput = z.infer<typeof sprintIdInput>

export const completeSprintInput = z.object({
  pageId: z.string().uuid(),
  id: z.string().uuid(),
  moveUndoneTo: z.string().uuid().nullable(),
})
export type CompleteSprintInput = z.infer<typeof completeSprintInput>

export const createTaskCommentInput = z.object({
  pageId: z.string().uuid(),
  taskId: z.string().uuid(),
  content: z.unknown(),
})
export type CreateTaskCommentInput = z.infer<typeof createTaskCommentInput>
