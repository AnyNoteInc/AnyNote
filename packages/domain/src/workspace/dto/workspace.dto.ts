import type { WorkspaceMember } from '@repo/db'

export interface WorkspaceMembershipDto {
  workspaceId: string
  userId: string
  role: WorkspaceMember['role']
}
