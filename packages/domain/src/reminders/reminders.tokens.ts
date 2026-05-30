export const REMINDERS = {
  Repository: Symbol.for('domain/ReminderRepository'),
  Service: Symbol.for('domain/ReminderService'),
  Scheduler: Symbol.for('domain/DeliveryScheduler'),
} as const
