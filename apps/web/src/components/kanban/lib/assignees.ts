import type { BoardAssignee } from '../types'

/** Whether a given user is among a task's assignees (via their linked participant). */
export function isAssignedTo(assignees: BoardAssignee[], userId: string): boolean {
  return assignees.some((a) => a.participant.userId === userId)
}

/**
 * Ids by which a task's assignees can be matched in the user filter: the linked
 * user id (for workspace members) AND the participant id (for guests, who have
 * no user). Members are filtered by `user.id`, guests by `participant.id`.
 */
export function assigneeFilterIds(assignees: BoardAssignee[]): string[] {
  return assignees.flatMap((a) =>
    a.participant.userId ? [a.participant.userId] : [a.participantId],
  )
}
