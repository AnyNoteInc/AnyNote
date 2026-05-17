export type StreamStatus = 'STREAMING' | 'DONE' | 'ERROR'

export type ServiceBlock = {
  id: string
  kind: 'tool' | 'confirmation'
  state: 'pending' | 'running' | 'done' | 'error' | 'required'
  title: string
  detail?: string
  result?: string
}

export type AgentsStreamEvent =
  | { type: 'token'; text: string }
  | ({
      type: 'status'
    } & ServiceBlock)
  | { type: 'done' }
  | { type: 'error'; code: string; message: string }

export type PlanStepEvent = {
  type: 'plan_step'
  id: string
  title: string
  position: number
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
}

export type ConfirmationRequiredEvent = {
  type: 'confirmation_required'
  confirmation_id: string
  tool: string
  summary: string
  args_preview: unknown
}

export type WebChatSseEvent =
  | { type: 'message.created'; assistantMessageId: string; userMessageId: string }
  | { type: 'message.delta'; assistantMessageId: string; text: string }
  | { type: 'message.service'; assistantMessageId: string; blocks: ServiceBlock[] }
  | {
      type: 'message.status'
      assistantMessageId: string
      status: StreamStatus
      errorMessage?: string
    }
  | { type: 'message.done'; assistantMessageId: string }
  | PlanStepEvent
  | ConfirmationRequiredEvent

export type StartChatGenerationBody = {
  chatId: string
  text: string
  fileIds: string[]
}
