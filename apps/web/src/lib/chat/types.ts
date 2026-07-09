export type StreamStatus = 'STREAMING' | 'DONE' | 'ERROR'

export type ServiceBlock = {
  id: string
  kind: 'tool' | 'confirmation'
  state: 'pending' | 'running' | 'done' | 'error' | 'required'
  title: string
  detail?: string
  result?: string
}

export type OrderedSegment =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | {
      type: 'tool'
      id: string
      kind: 'tool' | 'confirmation'
      state: ServiceBlock['state']
      title: string
      detail?: string
      result?: string
    }

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
  | { type: 'message.delta'; assistantMessageId: string; segmentIndex: number; text: string }
  | { type: 'message.segments'; assistantMessageId: string; segments: OrderedSegment[] }
  | { type: 'message.thinking'; assistantMessageId: string; text: string }
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
  useThinking?: boolean
  thinkingEffort?: 'LOW' | 'MEDIUM' | 'HIGH'
  /** PAGE chats only: client-serialized page markdown or the current selection (spec §6.3). */
  pageContext?: { content: string; isSelection: boolean }
}
