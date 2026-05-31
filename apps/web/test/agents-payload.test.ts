import { describe, expect, it } from 'vitest'

import { buildAgentRunPayload } from '../src/lib/chat/agents-payload'

const BASE_SETTINGS = {
  temperature: 0.7,
  topP: 0.9,
  systemPrompt: 'You are helpful.',
  defaultModel: {
    slug: 'GigaChat-2-Pro',
    provider: {
      kind: 'gigachat',
      connection: {
        clientId: 'cid',
        clientSecret: 'csecret',
        scope: 'GIGACHAT_API_PERS',
      },
    },
  },
  embeddingsModel: null,
} as const

describe('buildAgentRunPayload', () => {
  it('builds the correct top-level shape', () => {
    const payload = buildAgentRunPayload({
      chatId: '11111111-1111-1111-1111-111111111111',
      userMessage: 'hello',
      chatHistory: [],
      settings: BASE_SETTINGS,
      mcpServers: [],
      longTermMemories: [],
    })

    expect(payload.chat_id).toBe('11111111-1111-1111-1111-111111111111')
    expect(payload.user_message).toBe('hello')
    expect(payload.chat_history).toEqual([])
    expect(payload.model.provider).toBe('gigachat')
    expect(payload.model.name).toBe('GigaChat-2-Pro')
    expect(payload.agent_system_prompt).toBe('You are helpful.')
    expect(payload.embedding_config).toBeNull()
    expect(payload.mcp_servers).toEqual([])
    expect(payload.long_term_memories).toEqual([])
    expect(payload.allow_destructive).toBe(false)
  })

  it('passes chat history through', () => {
    const payload = buildAgentRunPayload({
      chatId: '11111111-1111-1111-1111-111111111111',
      userMessage: 'follow up',
      chatHistory: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'response' },
      ],
      settings: BASE_SETTINGS,
      mcpServers: [],
      longTermMemories: [],
    })

    expect(payload.chat_history).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'response' },
    ])
  })

  it('includes embedding_config when embeddingsModel is set', () => {
    const payload = buildAgentRunPayload({
      chatId: '11111111-1111-1111-1111-111111111111',
      userMessage: 'test',
      chatHistory: [],
      settings: {
        ...BASE_SETTINGS,
        embeddingsModel: {
          slug: 'nomic-embed-text',
          vectorSize: 768,
          provider: { kind: 'ollama', connection: { baseUrl: 'http://localhost:11434' } },
        },
      },
      mcpServers: [],
      longTermMemories: [],
    })

    expect(payload.embedding_config).toMatchObject({
      provider: 'ollama',
      modelSlug: 'nomic-embed-text',
      vectorSize: 768,
    })
  })

  it('passes mcp_servers through unchanged', () => {
    const server = {
      name: 'anynote',
      description: '',
      url: 'http://localhost:8082/mcp',
      transport: 'HTTP_JSONRPC' as const,
      headers: { authorization: 'Bearer sig' },
      tools: [],
      retries: 3,
      verify: false,
    }
    const payload = buildAgentRunPayload({
      chatId: '11111111-1111-1111-1111-111111111111',
      userMessage: 'test',
      chatHistory: [],
      settings: BASE_SETTINGS,
      mcpServers: [server],
      longTermMemories: [],
    })

    expect(payload.mcp_servers).toEqual([server])
  })

  it('passes long_term_memories through', () => {
    const payload = buildAgentRunPayload({
      chatId: '11111111-1111-1111-1111-111111111111',
      userMessage: 'test',
      chatHistory: [],
      settings: BASE_SETTINGS,
      mcpServers: [],
      longTermMemories: [{ key: 'user-pref', content: 'prefers short answers', scope: 'user' }],
    })

    expect(payload.long_term_memories).toEqual([
      { key: 'user-pref', content: 'prefers short answers', scope: 'user' },
    ])
  })
})

describe('buildAgentRunPayload attachments + reasoning', () => {
  it('includes attachments and reasoning fields', () => {
    const payload = buildAgentRunPayload({
      chatId: '11111111-1111-1111-1111-111111111111',
      userMessage: 'hi',
      chatHistory: [],
      settings: BASE_SETTINGS,
      mcpServers: [],
      longTermMemories: [],
      attachments: [
        {
          id: 'f1',
          name: 'a.md',
          mime: 'text/markdown',
          sizeBytes: 4,
          included: true,
          content: '# Hi',
        },
      ],
      reasoning: { enabled: true, effort: 'high' },
    })
    expect(payload.attachments?.[0]?.id).toBe('f1')
    expect(payload.attachments?.[0]?.included).toBe(true)
    expect(payload.reasoning).toEqual({ enabled: true, effort: 'high' })
  })

  it('defaults reasoning to disabled and attachments to empty', () => {
    const payload = buildAgentRunPayload({
      chatId: '11111111-1111-1111-1111-111111111111',
      userMessage: 'hi',
      chatHistory: [],
      settings: BASE_SETTINGS,
      mcpServers: [],
      longTermMemories: [],
    })
    expect(payload.reasoning).toEqual({ enabled: false, effort: 'medium' })
    expect(payload.attachments).toEqual([])
  })
})
