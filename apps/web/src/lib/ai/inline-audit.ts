import type { PrismaClient } from '@repo/db'

/**
 * Inline-AI audit catalog (spec §6), following the 8A/8C
 * `*_AUDIT_ACTIONS as const` pattern but located in web — the writer is the
 * Next route, not a domain repository. One action string; the specific preset
 * and token counts live in `metadata`.
 */
export const AI_AUDIT_ACTIONS = { inlineAiRun: 'ai.inline.run' } as const

export type InlineAiAuditEntry = {
  workspaceId: string
  userId: string
  preset: string
  provider: string
  model: string
  pageId: string
  promptTokens?: number | null
  completionTokens?: number | null
  totalTokens?: number | null
}

/**
 * Writes one `WorkspaceAuditLog` row per inline-AI invocation. Best-effort:
 * audit must NEVER break the user-facing action, so all failures are swallowed.
 * Token counts are persisted when the provider returned them, else null
 * (spec §6 sanctions this).
 */
export async function writeInlineAiAudit(
  prisma: Pick<PrismaClient, 'workspaceAuditLog'>,
  entry: InlineAiAuditEntry,
): Promise<void> {
  try {
    await prisma.workspaceAuditLog.create({
      data: {
        workspaceId: entry.workspaceId,
        actorId: entry.userId,
        action: AI_AUDIT_ACTIONS.inlineAiRun,
        metadata: {
          preset: entry.preset,
          provider: entry.provider,
          model: entry.model,
          pageId: entry.pageId,
          promptTokens: entry.promptTokens ?? null,
          completionTokens: entry.completionTokens ?? null,
          totalTokens: entry.totalTokens ?? null,
        },
      },
    })
  } catch {
    // Audit is best-effort; never surface its failure to the caller.
  }
}
