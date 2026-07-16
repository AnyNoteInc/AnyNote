import { RoleType, type PrismaClient } from '@repo/db'
import { emit, type EmitArgs } from '@repo/notifications'

type NotificationEmitter = (prisma: PrismaClient, args: EmitArgs) => Promise<unknown>

type NotifyFormManagersDependencies = {
  emitNotification?: NotificationEmitter
}

/**
 * Sends a metadata-only notification after a form response has committed.
 *
 * Recipient authority is resolved from current workspace membership on every
 * call. Blocked and former members must not learn that a response exists.
 */
export async function notifyFormManagers(
  prisma: PrismaClient,
  submissionId: string,
  dependencies: NotifyFormManagersDependencies = {},
): Promise<void> {
  const submission = await prisma.databaseFormSubmission.findUnique({
    where: { id: submissionId },
    select: {
      rowId: true,
      respondentUserId: true,
      submittedAt: true,
      version: { select: { versionNumber: true } },
      form: {
        select: {
          id: true,
          createdById: true,
          notifyOwners: true,
          viewId: true,
          view: { select: { title: true } },
          source: {
            select: {
              workspaceId: true,
              pageId: true,
              title: true,
              page: { select: { title: true } },
            },
          },
        },
      },
    },
  })
  if (submission === null || !submission.form.notifyOwners) return

  const { form } = submission
  const memberships = await prisma.workspaceMember.findMany({
    where: {
      workspaceId: form.source.workspaceId,
      OR: [{ userId: form.createdById }, { role: { in: [RoleType.OWNER, RoleType.ADMIN] } }],
    },
    select: { userId: true, role: true },
  })
  if (memberships.length === 0) return

  const blocked = await prisma.workspaceBlockedUser.findMany({
    where: {
      workspaceId: form.source.workspaceId,
      userId: { in: memberships.map(({ userId }) => userId) },
    },
    select: { userId: true },
  })
  const blockedIds = new Set(blocked.map(({ userId }) => userId))
  const activeMemberships = memberships.filter(({ userId }) => !blockedIds.has(userId))
  const managerIds = new Set(
    activeMemberships.flatMap(({ userId, role }) =>
      role === RoleType.OWNER || role === RoleType.ADMIN ? [userId] : [],
    ),
  )
  const recipients = new Set(activeMemberships.map(({ userId }) => userId))

  // A respondent does not self-notify merely because they originally created
  // the form. Current workspace managers still receive operational alerts.
  if (submission.respondentUserId !== null && !managerIds.has(submission.respondentUserId)) {
    recipients.delete(submission.respondentUserId)
  }
  if (recipients.size === 0) return

  const resourceUrl = `/workspaces/${form.source.workspaceId}/pages/${form.source.pageId}${
    form.viewId === null ? '' : `?viewId=${form.viewId}`
  }`
  const formLabel =
    form.view?.title.trim() ||
    form.source.title?.trim() ||
    form.source.page.title?.trim() ||
    'Без названия'
  const payload = {
    formId: form.id,
    versionNumber: submission.version.versionNumber,
    rowId: submission.rowId,
    formLabel,
    submittedAt: submission.submittedAt.toISOString(),
    resourceUrl,
  }
  const emitNotification = dependencies.emitNotification ?? emit

  await Promise.all(
    [...recipients].map((userId) =>
      emitNotification(prisma, {
        type: 'FORM_SUBMITTED',
        userId,
        workspaceId: form.source.workspaceId,
        resourceUrl,
        payload,
      }),
    ),
  )
}
