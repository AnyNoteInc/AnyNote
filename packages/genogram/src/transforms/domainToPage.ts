import type { GenogramPageData } from "../types"
import { parseGenogram } from "../model/validators"

/**
 * Snapshot: validates a domain model before writing it to Page.content.
 * Throws on invalid data — saving a broken snapshot would corrupt Yjs state
 * on reload, so failing loud is the correct default.
 */
export function domainToPage(data: GenogramPageData): GenogramPageData {
  return parseGenogram(data)
}
