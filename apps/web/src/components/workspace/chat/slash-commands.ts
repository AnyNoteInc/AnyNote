export type SlashCommandState = {
  open: boolean
  query: string
}

/**
 * Decide whether the slash-command menu should be open for the current composer
 * value. The menu opens only while the user is typing a single leading token
 * after `/` (no whitespace yet) — once a space or newline appears the user has
 * moved on to arguments / free text, so the menu closes.
 */
export function parseSlashCommand(value: string): SlashCommandState {
  if (!value.startsWith('/')) return { open: false, query: '' }
  const rest = value.slice(1)
  if (rest.includes(' ') || rest.includes('\n')) return { open: false, query: '' }
  return { open: true, query: rest }
}
