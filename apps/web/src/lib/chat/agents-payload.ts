import { parseAiProviderConnection } from '@repo/db'

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
  embeddingsModel: {
    slug: string
    vectorSize: number
    provider: {
      slug: string
      connection: unknown
    }
  } | null
}

export type AgentConversationMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type McpServerEntry = {
  name: string
  description: string
  url: string
  transport: 'HTTP_JSONRPC' | 'SSE'
  headers: Record<string, string>
  tools: string[]
  retries: number
  verify: boolean
  workspaceId?: string
}

export type AgentRunPayload = {
  chat_id: string
  user_message: string
  chat_history: AgentConversationMessage[]
  model: {
    provider: string
    name: string
    connection: Record<string, string>
    settings: { temperature: number | null; topP: number | null }
  }
  embedding_config: {
    provider: string
    modelSlug: string
    vectorSize: number
    connection: Record<string, string>
  } | null
  mcp_servers: McpServerEntry[]
  agent_system_prompt: string | null
  long_term_memories: Array<{ key: string; content: string; scope: 'workspace' | 'user' }>
  allow_destructive: boolean
}

function normalizeConnection(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  const connection: Record<string, string> = {}
  for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (typeof candidate === 'string') {
      connection[key] = candidate
    }
  }
  return connection
}

export function buildAgentRunPayload(args: {
  chatId: string
  userMessage: string
  chatHistory: AgentConversationMessage[]
  settings: WorkspaceSettingsSnapshot
  mcpServers: McpServerEntry[]
  longTermMemories: AgentRunPayload['long_term_memories']
  allowDestructive?: boolean
}): AgentRunPayload {
  const embeddingConfig = args.settings.embeddingsModel
    ? {
        provider: args.settings.embeddingsModel.provider.slug,
        modelSlug: args.settings.embeddingsModel.slug,
        vectorSize: args.settings.embeddingsModel.vectorSize,
        connection: normalizeConnection(
          parseAiProviderConnection(
            args.settings.embeddingsModel.provider.slug,
            args.settings.embeddingsModel.provider.connection,
          ),
        ),
      }
    : null

  return {
    chat_id: args.chatId,
    user_message: args.userMessage,
    chat_history: args.chatHistory,
    model: {
      provider: args.settings.defaultModel.provider.slug,
      name: args.settings.defaultModel.slug,
      connection: normalizeConnection(args.settings.defaultModel.provider.connection),
      settings: {
        temperature: args.settings.temperature,
        topP: args.settings.topP,
      },
    },
    embedding_config: embeddingConfig,
    mcp_servers: args.mcpServers,
    agent_system_prompt: args.settings.systemPrompt ?? null,
    long_term_memories: args.longTermMemories,
    allow_destructive: args.allowDestructive ?? false,
  }
}
