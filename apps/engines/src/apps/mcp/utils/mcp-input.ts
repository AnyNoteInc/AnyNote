import { z } from "zod"

const UUID_EXTRACT_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi

function normalizeNullish(value: unknown): unknown {
  if (value == null) {
    return undefined
  }

  return value
}

function extractSingleUuid(value: string): string | null {
  const matches = value.match(UUID_EXTRACT_RE) ?? []
  const uniqueMatches = [...new Set(matches.map((match) => match.toLowerCase()))]
  return uniqueMatches.length === 1 ? (uniqueMatches[0] ?? null) : null
}

function normalizeUuidLike(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) {
      return trimmed
    }

    return extractSingleUuid(trimmed) ?? trimmed
  }

  if (typeof value === "object" && value !== null) {
    const serialized = JSON.stringify(value)
    return extractSingleUuid(serialized) ?? value
  }

  return value
}

export function mcpUuid() {
  return z.preprocess(normalizeUuidLike, z.string().uuid())
}

export function mcpNullableUuidOptional() {
  return z.preprocess(normalizeUuidLike, z.string().uuid().nullable().optional())
}

export function mcpInput<TSchema extends z.ZodTypeAny>(schema: TSchema) {
  return z.preprocess(normalizeNullish, schema)
}
