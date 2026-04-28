export type { MailKind, MailPayloads, MailEventPayload, RenderedEmail } from './types.js'
export { renderTemplate } from './templates/index.js'
export { enqueueMailEvent, type EnqueueMailEventArgs } from './enqueue.js'
export { getMailTransport } from './transport.js'
export {
  dispatchPending,
  type DispatchResult,
  type DispatchOptions,
} from './dispatch.js'
