import type { Editor } from '@tiptap/core'

import type { InlineAiCapturedRange } from '../components/inline-ai-popover'
import type { AskAICallback } from '../types'

// The inline-AI capability injected onto `editor.storage.ai` (the comments-storage
// precedent). `askAI` gates the triggers (bubble-menu button, drag-handle menu
// item); `onAskAi` opens the action popover that anynote-editor mounts as a
// sibling, fed the captured range + anchor.
export type AiStorage = {
  askAI?: AskAICallback | null
  onAskAi?: (captured: InlineAiCapturedRange) => void
}

export function readAiStorage(editor: Editor): AiStorage | undefined {
  return (editor.storage as unknown as { ai?: AiStorage }).ai
}
