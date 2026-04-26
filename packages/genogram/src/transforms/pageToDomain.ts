import type { GenogramPageData } from '../types'
import { createEmptyGenogram } from '../model/factories'
import { parseGenogram, safeParseGenogram, type ValidationIssue } from '../model/validators'
import { migrate } from './migrate'

function isEmptyInput(raw: unknown): boolean {
  if (raw == null) return true
  if (typeof raw !== 'object') return false
  return Object.keys(raw as Record<string, unknown>).length === 0
}

/**
 * Strict: parses raw Page.content into a validated domain model.
 * Throws on malformed input. Use in contexts where a failure should halt
 * rendering (e.g. server-side snapshot generation).
 */
export function pageToDomain(raw: unknown): GenogramPageData {
  if (isEmptyInput(raw)) return createEmptyGenogram()
  return parseGenogram(migrate(raw))
}

export type PageToDomainResult =
  | { ok: true; data: GenogramPageData }
  | { ok: false; issues: ValidationIssue[] }

/**
 * Graceful: returns issues instead of throwing so callers can surface a
 * repair prompt in the UI.
 */
export function pageToDomainSafe(raw: unknown): PageToDomainResult {
  if (isEmptyInput(raw)) return { ok: true, data: createEmptyGenogram() }
  return safeParseGenogram(migrate(raw))
}
