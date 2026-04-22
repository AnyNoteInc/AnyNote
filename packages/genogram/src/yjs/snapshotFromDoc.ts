import type * as Y from "yjs"
import type { GenogramPageData } from "../types"
import { domainToPage } from "../transforms"
import { assembleDomain } from "./assembleDomain"

/**
 * Produces a validated JSON snapshot ready for Page.content. Goes through
 * domainToPage (zod) as a last-line defence against writing a broken
 * snapshot — if a future Y.Doc mutation produces an invalid shape this
 * throws before corruption reaches the DB.
 */
export function snapshotFromDoc(doc: Y.Doc): GenogramPageData {
  return domainToPage(assembleDomain(doc))
}
