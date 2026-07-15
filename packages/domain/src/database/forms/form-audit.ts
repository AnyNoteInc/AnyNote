import type { UnitOfWork } from '../../shared/unit-of-work.ts'

export const FORM_AUDIT = {
  CREATED: 'database_form.created',
  PUBLISHED: 'database_form.published',
  OPENED: 'database_form.opened',
  CLOSED: 'database_form.closed',
  ARCHIVED: 'database_form.archived',
  SETTINGS_CHANGED: 'database_form.settings_changed',
  SLUG_CHANGED: 'database_form.slug_changed',
  KEY_ROTATED: 'database_form.key_rotated',
} as const

export type FormAuditAction = (typeof FORM_AUDIT)[keyof typeof FORM_AUDIT]

export type FormAuditMetadata = {
  formId: string
  viewId?: string
  versionNumber?: number
  changedSettings?: string[]
}

export async function writeFormAudit(
  uow: UnitOfWork,
  input: {
    workspaceId: string
    actorId: string
    action: FormAuditAction
    metadata: FormAuditMetadata
  },
): Promise<void> {
  await uow.client().workspaceAuditLog.create({
    data: {
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      action: input.action,
      metadata: input.metadata,
    },
  })
}
