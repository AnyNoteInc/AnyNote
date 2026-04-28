import type { MailKind, MailPayloads, RenderedEmail } from '../types.js'

// Реализации добавляются в Task 3.
export function renderTemplate<K extends MailKind>(
  _kind: K,
  _data: MailPayloads[K],
): RenderedEmail {
  throw new Error('renderTemplate: not implemented yet (Task 3)')
}
