/**
 * Server-side preset transform actions for inline AI (spec §3.1 step 6, §7
 * invariant 3). The client sends only `{action, selectedText, …}` and picks a
 * preset BY NAME — the action→prompt mapping lives here, on the server, so the
 * client can never inject an arbitrary system prompt. The selected text is the
 * only model context, length-capped before it reaches the provider.
 */

/** Hard cap on how much of the selection is sent to the model. */
export const MAX_SELECTION_CHARS = 8_000

/**
 * The inline-AI meta-instructions, appended to the workspace system prompt by
 * the handler. They used to live inside the user message («Выведи только
 * результат без пояснений.») — weaker models echoed that boilerplate (and the
 * quoted source text) back into the streamed answer, which then landed in the
 * document on accept. System-level placement keeps the user message down to
 * instruction + text, leaving nothing echo-worthy.
 */
export const INLINE_AI_SYSTEM_PROMPT =
  'Ты выполняешь инлайн-задачу в текстовом редакторе: твой ответ вставляется в документ как есть. ' +
  'Выведи ТОЛЬКО итоговый результат в markdown — без пояснений, вступлений и завершающих комментариев, ' +
  'без повторения инструкции или исходного текста, без обрамляющих кавычек и без код-фенса вокруг всего ответа. ' +
  'Для диаграмм используй fenced-блоки кода (например ```mermaid). Отвечай на языке инструкции.'

/** The six preset transform instructions (the action allow-list authority). */
export const INLINE_AI_ACTIONS = {
  summarize: 'Сократи следующий текст до краткого резюме, сохранив главные мысли.',
  rewrite: 'Перепиши следующий текст более ясно и естественно, сохранив смысл.',
  grammar:
    'Исправь грамматику, орфографию и стиль следующего текста. Верни только исправленный текст.',
  translate: 'Переведи следующий текст на {targetLang}. Верни только перевод.',
  shorten: 'Сделай следующий текст короче, сохранив суть.',
  expand: 'Дополни и расширь следующий текст, добавив полезные детали в том же стиле.',
} as const

export type InlineAiAction = keyof typeof INLINE_AI_ACTIONS

/** Default translation target when the client omits / blanks `targetLang`. */
const DEFAULT_TARGET_LANG = 'English'

/**
 * Type-guard against the preset allow-list. Uses `hasOwnProperty` so prototype
 * keys (`toString`, `__proto__`, …) never pass.
 */
export function isInlineAiAction(value: string): value is InlineAiAction {
  return Object.prototype.hasOwnProperty.call(INLINE_AI_ACTIONS, value)
}

/**
 * Build the `user_message` sent to the agent: the preset instruction plus the
 * (length-capped) selected text. The "output only the result" meta-instruction
 * lives in INLINE_AI_SYSTEM_PROMPT (system-level), NOT here — in the user
 * message the model tended to echo it back into the answer.
 */
export function buildInlinePrompt(
  action: InlineAiAction,
  selectedText: string,
  opts: { targetLang?: string },
): string {
  const capped = selectedText.slice(0, MAX_SELECTION_CHARS)
  const instruction = INLINE_AI_ACTIONS[action].replace(
    '{targetLang}',
    opts.targetLang?.trim() || DEFAULT_TARGET_LANG,
  )
  return `${instruction}\n\nТекст:\n"""\n${capped}\n"""`
}

/** Caps for the space-bar `generate` and free-form `custom` actions (spec §4). */
export const MAX_INSTRUCTION_CHARS = 2_000
export const MAX_CUSTOM_INSTRUCTION_CHARS = 500
export const MAX_CONTEXT_BEFORE_CHARS = 8_000
export const MAX_HISTORY_TURNS = 10
export const MAX_HISTORY_TURN_CHARS = 16_000
export const MAX_HISTORY_TOTAL_CHARS = 48_000

/** Free-form actions beside the preset allow-list. Prompt templates stay server-side. */
const EXTENDED_ACTIONS = new Set(['custom', 'generate'])

export type ExtendedInlineAiAction = 'custom' | 'generate'

export function isExtendedInlineAiAction(value: string): value is ExtendedInlineAiAction {
  return EXTENDED_ACTIONS.has(value)
}

/**
 * Space-bar drafting prompt (spec §4). `contextBefore` is the page text above
 * the cursor — kept tail-first so «продолжи текст» continues the nearest text.
 */
export function buildGeneratePrompt(instruction: string, opts: { contextBefore?: string }): string {
  const cappedInstruction = instruction.slice(0, MAX_INSTRUCTION_CHARS)
  const context = (opts.contextBefore ?? '').slice(-MAX_CONTEXT_BEFORE_CHARS).trim()
  const contextBlock = context
    ? `Контекст страницы над курсором (для продолжения и стиля):\n"""\n${context}\n"""\n\n`
    : ''
  return `${contextBlock}Инструкция: ${cappedInstruction}`
}

/** Free-form transform of the selection (spec §4) — same shape as the presets. */
export function buildCustomPrompt(instruction: string, selectedText: string): string {
  const cappedInstruction = instruction.slice(0, MAX_CUSTOM_INSTRUCTION_CHARS)
  const cappedText = selectedText.slice(0, MAX_SELECTION_CHARS)
  return `${cappedInstruction}\n\nТекст:\n"""\n${cappedText}\n"""`
}
