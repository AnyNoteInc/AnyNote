/**
 * Server-side preset transform actions for inline AI (spec §3.1 step 6, §7
 * invariant 3). The client sends only `{action, selectedText, …}` and picks a
 * preset BY NAME — the action→prompt mapping lives here, on the server, so the
 * client can never inject an arbitrary system prompt. The selected text is the
 * only model context, length-capped before it reaches the provider.
 */

/** Hard cap on how much of the selection is sent to the model. */
export const MAX_SELECTION_CHARS = 8_000

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
 * (length-capped) selected text. Output is kept paste-ready — the model is told
 * to return only the transformed text, no preamble.
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
  return `${instruction}\n\nВыведи только результат без пояснений.\n\nТекст:\n"""\n${capped}\n"""`
}
