import { z } from "zod"

const UUID_EXTRACT_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi

function normalizeNullish(value: unknown): unknown {
  if (value == null) {
    return undefined
  }

  return value
}

function normalizeUuidLike(value: unknown): unknown {
  if (typeof value !== "string") {
    return value
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return trimmed
  }

  const matches = trimmed.match(UUID_EXTRACT_RE) ?? []
  if (matches.length !== 1) {
    return trimmed
  }

  return matches[0]
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
