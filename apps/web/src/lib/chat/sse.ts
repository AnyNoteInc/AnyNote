import type { WebChatSseEvent } from './types'

const encoder = new TextEncoder()

export function encodeSseEvent(event: WebChatSseEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
}

function decodeSseEvents<T extends { type: string }>(args: {
  buffer: string
  chunk: string
}): { buffer: string; events: T[] } {
  const combined = args.buffer + args.chunk
  const frames = combined.split(/\r?\n\r?\n/)
  const trailing = frames.pop() ?? ''
  const events: T[] = []

  for (const frame of frames) {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n')

    if (!data) {
      continue
    }

    try {
      const parsed = JSON.parse(data) as T
      if (parsed && typeof parsed === 'object' && 'type' in parsed) {
        events.push(parsed)
      }
    } catch {
      continue
    }
  }

  return {
    buffer: trailing,
    events,
  }
}

export function decodeWebSseEvents(args: { buffer: string; chunk: string }): {
  buffer: string
  events: WebChatSseEvent[]
} {
  return decodeSseEvents<WebChatSseEvent>(args)
}
