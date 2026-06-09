import type { PageRevisionAction } from '@repo/db'
import type { Prisma } from '@repo/db'

/**
 * Port for recording a structural page revision without coupling the pages
 * module's service to the page-history module internals. `RevisionCaptureService`
 * structurally satisfies this; the DI module wires the concrete service in.
 * Keeping the dependency on this shared port (not `page-history/services/...`)
 * preserves domain-module isolation and avoids a pages ⇆ page-history cycle
 * (see `.dependency-cruiser.cjs`, mirrors the `ItemPageCreator` precedent).
 */
export interface RevisionRecorder {
  captureStructuralRevision(input: {
    pageId: string
    actorId: string | null
    action: PageRevisionAction
    metadata: Prisma.InputJsonValue | null
  }): Promise<void>
}
