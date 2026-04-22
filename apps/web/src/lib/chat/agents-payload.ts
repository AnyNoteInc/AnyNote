export type WorkspaceSettingsSnapshot = {
  temperature: number | null
  topP: number | null
  systemPrompt: string | null
  defaultModel: {
    slug: string
    provider: {
      slug: string
      connection: unknown
    }
  }
}

function normalizeConnection(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }

  const connection: Record<string, string> = {}
  for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (typeof candidate === "string") {
      connection[key] = candidate
    }
  }
  return connection
}

export function buildAgentsPayload(args: {
  chatId: string
  workspaceId: string
  userId: string
  text: string
  settings: WorkspaceSettingsSnapshot
}) {
  return {
    threadId: args.chatId,
    model: {
      provider: args.settings.defaultModel.provider.slug,
      name: args.settings.defaultModel.slug,
      connection: normalizeConnection(args.settings.defaultModel.provider.connection),
      settings: {
        temperature: args.settings.temperature,
        topP: args.settings.topP,
      },
    },
    systemPrompt: args.settings.systemPrompt ?? "",
    mcp: {
      servers: [
        {
          name: "AnyNote MCP Server",
          url: process.env.ANYNOTE_MCP_URL ?? "http://localhost:8090/api/mcp",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            "X-User-Id": args.userId,
            "x-Workspace-Id": args.workspaceId,
          },
          retries: 3,
          verify: false,
        },
      ],
    },
    instruction: {
      format: "markdown",
      language: "ru",
      citationsRequired: true,
    },
    query: args.text,
  }
}
