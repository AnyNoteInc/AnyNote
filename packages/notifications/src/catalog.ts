import type { EventDescriptor } from './types.ts'
import type { NotificationEventType } from '@repo/db'

export const EVENT_CATALOG: Record<NotificationEventType, EventDescriptor> = {
  // SERVICE
  VERIFY_EMAIL: {
    category: 'SERVICE',
    defaultChannels: ['EMAIL'],
    lockedChannels: ['EMAIL'],
    requiresConsent: null,
  },
  RESET_PASSWORD: {
    category: 'SERVICE',
    defaultChannels: ['EMAIL'],
    lockedChannels: ['EMAIL'],
    requiresConsent: null,
  },
  PASSWORD_CHANGED: {
    category: 'SERVICE',
    defaultChannels: ['EMAIL'],
    lockedChannels: ['EMAIL'],
    requiresConsent: null,
  },
  EMAIL_CHANGED: {
    category: 'SERVICE',
    defaultChannels: ['EMAIL'],
    lockedChannels: ['EMAIL'],
    requiresConsent: null,
  },
  WELCOME: {
    category: 'SERVICE',
    defaultChannels: ['EMAIL'],
    lockedChannels: ['EMAIL'],
    requiresConsent: null,
  },
  ACCOUNT_DELETION_REQUESTED: {
    category: 'SERVICE',
    defaultChannels: ['EMAIL'],
    lockedChannels: ['EMAIL'],
    requiresConsent: null,
  },
  ACCOUNT_DELETION_COMPLETED: {
    category: 'SERVICE',
    defaultChannels: ['EMAIL'],
    lockedChannels: ['EMAIL'],
    requiresConsent: null,
  },
  // SECURITY
  NEW_LOGIN: {
    category: 'SECURITY',
    defaultChannels: ['EMAIL', 'IN_APP'],
    lockedChannels: ['IN_APP'],
    requiresConsent: null,
  },
  SUSPICIOUS_ACTIVITY: {
    category: 'SECURITY',
    defaultChannels: ['EMAIL', 'IN_APP'],
    lockedChannels: ['IN_APP'],
    requiresConsent: null,
  },
  // COLLABORATION
  WORKSPACE_INVITE: {
    category: 'COLLABORATION',
    defaultChannels: ['EMAIL', 'IN_APP'],
    lockedChannels: ['IN_APP'],
    requiresConsent: null,
  },
  ROLE_CHANGED: {
    category: 'COLLABORATION',
    defaultChannels: ['IN_APP'],
    lockedChannels: ['IN_APP'],
    requiresConsent: null,
  },
  PAGE_MENTION: {
    category: 'COLLABORATION',
    defaultChannels: ['EMAIL', 'IN_APP'],
    lockedChannels: ['IN_APP'],
    requiresConsent: null,
  },
  COMMENT_CREATED: {
    category: 'COLLABORATION',
    defaultChannels: ['EMAIL', 'IN_APP'],
    lockedChannels: ['IN_APP'],
    requiresConsent: null,
  },
  REMINDER_DUE: {
    category: 'COLLABORATION',
    defaultChannels: ['IN_APP', 'EMAIL', 'WEB_PUSH'],
    lockedChannels: ['IN_APP'],
    requiresConsent: null,
  },
  COMMENT_REPLY: {
    category: 'COLLABORATION',
    defaultChannels: ['IN_APP', 'EMAIL'],
    lockedChannels: ['IN_APP'],
    requiresConsent: null,
  },
  DATABASE_UPDATE: {
    category: 'COLLABORATION',
    defaultChannels: ['IN_APP', 'EMAIL'],
    lockedChannels: ['IN_APP'],
    requiresConsent: null,
  },
  DATABASE_PERSON_ASSIGNED: {
    category: 'COLLABORATION',
    defaultChannels: ['IN_APP', 'EMAIL'],
    lockedChannels: ['IN_APP'],
    requiresConsent: null,
  },
  DATABASE_DATE_REMINDER: {
    category: 'COLLABORATION',
    defaultChannels: ['IN_APP', 'EMAIL', 'WEB_PUSH'],
    lockedChannels: ['IN_APP'],
    requiresConsent: null,
  },
  FORM_SUBMITTED: {
    category: 'COLLABORATION',
    defaultChannels: ['IN_APP', 'EMAIL'],
    lockedChannels: ['IN_APP'],
    requiresConsent: null,
  },
  PAGE_REVISION_RESTORED: {
    category: 'COLLABORATION',
    defaultChannels: ['IN_APP'],
    lockedChannels: ['IN_APP'],
    requiresConsent: null,
  },
  // Phase 8C: a member asks an OWNER to approve a guest invite (security policy).
  GUEST_INVITE_REQUESTED: {
    category: 'COLLABORATION',
    defaultChannels: ['IN_APP'],
    lockedChannels: ['IN_APP'],
    requiresConsent: null,
  },
  // MARKETING
  WEEKLY_DIGEST: {
    category: 'MARKETING',
    defaultChannels: ['EMAIL'],
    lockedChannels: [],
    requiresConsent: 'MARKETING',
  },
  PRODUCT_UPDATE: {
    category: 'MARKETING',
    defaultChannels: ['EMAIL'],
    lockedChannels: [],
    requiresConsent: 'MARKETING',
  },
}
