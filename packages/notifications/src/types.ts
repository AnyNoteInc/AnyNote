import type {
  NotificationCategory,
  NotificationChannel,
  NotificationEventType,
  DeliveryStatus,
  PushSubscription,
} from '@repo/db'

export {
  NotificationCategory,
  NotificationChannel,
  NotificationEventType,
  DeliveryStatus,
} from '@repo/db'

export type EventDescriptor = {
  category: NotificationCategory
  defaultChannels: NotificationChannel[]
  lockedChannels: NotificationChannel[]
  requiresConsent: 'MARKETING' | null
}

export type EmitArgs<P extends Record<string, unknown> = Record<string, unknown>> = {
  type: NotificationEventType
  userId: string
  workspaceId?: string
  actorId?: string
  resourceUrl?: string
  payload: P
}

export type ResolvedTargets = {
  email: string | null
  pushSubscriptions: PushSubscription[]
}
