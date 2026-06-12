import type { PrismaClient } from '@repo/db'

import { emit } from './emit.ts'

export const notify = {
  verifyEmail: (
    prisma: PrismaClient,
    args: { userId: string; firstName: string; link: string; expiresAtIso: string },
  ) => emit(prisma, { type: 'VERIFY_EMAIL', userId: args.userId, payload: args }),

  resetPassword: (
    prisma: PrismaClient,
    args: { userId: string; firstName: string; link: string; expiresAtIso: string },
  ) => emit(prisma, { type: 'RESET_PASSWORD', userId: args.userId, payload: args }),

  passwordChanged: (
    prisma: PrismaClient,
    args: { userId: string; firstName: string; ipAddress?: string; supportEmail?: string },
  ) => emit(prisma, { type: 'PASSWORD_CHANGED', userId: args.userId, payload: args }),

  emailChanged: (
    prisma: PrismaClient,
    args: {
      userId: string
      firstName: string
      oldEmail: string
      newEmail: string
      isOldRecipient: boolean
    },
  ) => emit(prisma, { type: 'EMAIL_CHANGED', userId: args.userId, payload: args }),

  welcome: (prisma: PrismaClient, args: { userId: string; firstName: string; appUrl: string }) =>
    emit(prisma, { type: 'WELCOME', userId: args.userId, payload: args }),

  accountDeletionRequested: (
    prisma: PrismaClient,
    args: { userId: string; firstName: string; link: string; expiresAtIso: string },
  ) => emit(prisma, { type: 'ACCOUNT_DELETION_REQUESTED', userId: args.userId, payload: args }),

  accountDeletionCompleted: (prisma: PrismaClient, args: { userId: string; firstName: string }) =>
    emit(prisma, { type: 'ACCOUNT_DELETION_COMPLETED', userId: args.userId, payload: args }),

  newLogin: (
    prisma: PrismaClient,
    args: {
      userId: string
      firstName: string
      ipAddress: string
      userAgent: string
      location?: string
      loggedAtIso?: string
    },
  ) =>
    emit(prisma, {
      type: 'NEW_LOGIN',
      userId: args.userId,
      payload: { ...args, loggedAtIso: args.loggedAtIso ?? new Date().toISOString() },
    }),

  suspiciousActivity: (
    prisma: PrismaClient,
    args: { userId: string; firstName: string; reason: string; lockedUntilIso?: string },
  ) => emit(prisma, { type: 'SUSPICIOUS_ACTIVITY', userId: args.userId, payload: args }),

  workspaceInvite: (
    prisma: PrismaClient,
    args: {
      userId: string
      workspaceId: string
      actorId?: string
      firstName?: string
      inviterName: string
      workspaceName: string
      link: string
    },
  ) =>
    emit(prisma, {
      type: 'WORKSPACE_INVITE',
      userId: args.userId,
      workspaceId: args.workspaceId,
      actorId: args.actorId,
      resourceUrl: `/workspaces/${args.workspaceId}`,
      payload: args,
    }),

  roleChanged: (
    prisma: PrismaClient,
    args: {
      userId: string
      workspaceId: string
      actorId?: string
      newRole: string
      workspaceName: string
      actorName?: string
    },
  ) =>
    emit(prisma, {
      type: 'ROLE_CHANGED',
      userId: args.userId,
      workspaceId: args.workspaceId,
      actorId: args.actorId,
      resourceUrl: `/workspaces/${args.workspaceId}/settings`,
      payload: args,
    }),

  // Phase 8C: a member asks an OWNER to approve a guest invite while the
  // security policy disables direct invites. IN_APP-only (internal surface —
  // the owner sees requester + page title; the invitee gets mail only after
  // approval). `args.userId` is the OWNER being notified, `actorId` the requester.
  guestInviteRequested: (
    prisma: PrismaClient,
    args: {
      userId: string
      workspaceId: string
      actorId?: string
      requesterName: string
      pageTitle: string
      workspaceName: string
      link: string
    },
  ) =>
    emit(prisma, {
      type: 'GUEST_INVITE_REQUESTED',
      userId: args.userId,
      workspaceId: args.workspaceId,
      actorId: args.actorId,
      // Members-settings deep link (the roleChanged precedent): the legacy
      // route activates the workspace; the pending queue lives in workspace
      // settings («Безопасность», badged from the members section).
      // Legacy URL shape kept for consistency with all notification links;
      // redirects to the neutral route.
      resourceUrl: `/workspaces/${args.workspaceId}/settings`,
      payload: args,
    }),

  // Reserved stubs (no trigger points wired in v1).
  pageMention: (
    prisma: PrismaClient,
    args: {
      userId: string
      workspaceId: string
      pageId: string
      actorId?: string
      actorName: string
      snippet: string
    },
  ) =>
    emit(prisma, {
      type: 'PAGE_MENTION',
      userId: args.userId,
      workspaceId: args.workspaceId,
      actorId: args.actorId,
      resourceUrl: `/workspaces/${args.workspaceId}/pages/${args.pageId}`,
      payload: args,
    }),

  commentCreated: (
    prisma: PrismaClient,
    args: {
      userId: string
      workspaceId: string
      pageId: string
      commentId: string
      actorId?: string
      actorName: string
      snippet: string
    },
  ) =>
    emit(prisma, {
      type: 'COMMENT_CREATED',
      userId: args.userId,
      workspaceId: args.workspaceId,
      actorId: args.actorId,
      resourceUrl: `/workspaces/${args.workspaceId}/pages/${args.pageId}#comment-${args.commentId}`,
      payload: args,
    }),

  // ── Phase 5: page-activity helpers (Notify-me) ─────────────────────────────
  // Each payload carries `pageId`/`actorId` so the dedup guard + Inbox grouping
  // can key on them. `threadId` ties a comment reply to its thread.

  commentReply: (
    prisma: PrismaClient,
    args: {
      userId: string
      workspaceId: string
      pageId: string
      threadId: string
      commentId: string
      actorId?: string
      actorName: string
      snippet: string
    },
  ) =>
    emit(prisma, {
      type: 'COMMENT_REPLY',
      userId: args.userId,
      workspaceId: args.workspaceId,
      actorId: args.actorId,
      resourceUrl: `/workspaces/${args.workspaceId}/pages/${args.pageId}#comment-${args.commentId}`,
      payload: args,
    }),

  databaseUpdate: (
    prisma: PrismaClient,
    args: {
      userId: string
      workspaceId: string
      pageId: string
      rowId: string
      propertyId: string
      actorId?: string
      actorName: string
      label: string
    },
  ) =>
    emit(prisma, {
      type: 'DATABASE_UPDATE',
      userId: args.userId,
      workspaceId: args.workspaceId,
      actorId: args.actorId,
      resourceUrl: `/workspaces/${args.workspaceId}/pages/${args.pageId}`,
      payload: args,
    }),

  databasePersonAssigned: (
    prisma: PrismaClient,
    args: {
      userId: string
      workspaceId: string
      pageId: string
      rowId: string
      propertyId: string
      actorId?: string
      actorName: string
      label: string
    },
  ) =>
    emit(prisma, {
      type: 'DATABASE_PERSON_ASSIGNED',
      userId: args.userId,
      workspaceId: args.workspaceId,
      actorId: args.actorId,
      resourceUrl: `/workspaces/${args.workspaceId}/pages/${args.pageId}`,
      payload: args,
    }),

  databaseDateReminder: (
    prisma: PrismaClient,
    args: {
      userId: string
      workspaceId: string
      pageId: string
      rowId: string
      propertyId: string
      label: string
      dueAt: string
      offsetMinutes: number
    },
  ) =>
    emit(prisma, {
      type: 'DATABASE_DATE_REMINDER',
      userId: args.userId,
      workspaceId: args.workspaceId,
      resourceUrl: `/workspaces/${args.workspaceId}/pages/${args.pageId}`,
      payload: args,
    }),

  weeklyDigest: (prisma: PrismaClient, args: { userId: string; period: string; summary: string }) =>
    emit(prisma, { type: 'WEEKLY_DIGEST', userId: args.userId, payload: args }),

  productUpdate: (
    prisma: PrismaClient,
    args: { userId: string; title: string; body: string; url?: string },
  ) =>
    emit(prisma, {
      type: 'PRODUCT_UPDATE',
      userId: args.userId,
      resourceUrl: args.url,
      payload: args,
    }),
}
