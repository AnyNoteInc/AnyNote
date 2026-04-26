# Chat History + Loading Phrases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send conversation history to the agents service via the existing `messages` field of `QueryRequestSchema`, replace the empty assistant bubble with rotating loading phrases, and confirm RAG block-anchor links still appear via Playwright.

**Architecture:**

1. New module `apps/web/src/lib/chat/chat-history.ts` walks the parent chain of `Chat.parentId` and slices messages per the spec (current chat: first + last 10; each ancestor: first + last 4). Returns `Array<{ role: "user" | "assistant", content: string }>` ordered root → current.
2. `buildAgentsPayload` accepts the new `messages` array and includes it in the JSON sent to `/chat/generate`. Pydantic's `QueryRequestSchema` already has the field — no agent-side changes.
3. `apps/web/src/app/api/agents/generate/route.ts` fetches history **before** the transaction that creates the new user/assistant rows so the new query is not duplicated, then passes it through to `streamAgentsToRegistry → buildAgentsPayload`.
4. New `ChatLoadingPhrases` component in `@repo/ui` cycles through `Загрузка → Вычисления → Преобразование → Литье` on a 1s interval. `ChatMessageList` renders it (in place of `ChatMessageContent`) when an assistant message is in `streaming` status with empty `parts`.
5. The existing `apps/e2e/rag-block-links.spec.ts` already asserts the `<a href=".../pages/{pageId}#{block}">` anchor; we re-run it after changes to confirm regressions.

**Tech Stack:** TypeScript, Prisma 7, Vitest + Testing Library + jsdom, MUI v6, React 19, Playwright.

---

## File Structure

| File                                                       | Status | Responsibility                                                           |
| ---------------------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| `apps/web/src/lib/chat/agents-payload.ts`                  | Modify | Add `messages` to function args + return shape                           |
| `apps/web/test/agents-payload.test.ts`                     | Modify | Cover new `messages` field                                               |
| `apps/web/src/lib/chat/chat-history.ts`                    | Create | Recursive history collector with slicing rules                           |
| `apps/web/test/chat-history.test.ts`                       | Create | Unit-test all slicing scenarios with mocked Prisma                       |
| `apps/web/src/app/api/agents/generate/route.ts`            | Modify | Select `parentId`, fetch history before transaction, thread it through   |
| `apps/web/test/api-agents-generate.test.ts`                | Modify | Assert `messages` is forwarded to agents upstream                        |
| `packages/ui/src/components/chat/chat-loading-phrases.tsx` | Create | Component cycling 4 phrases every 1000 ms                                |
| `packages/ui/test/chat-loading-phrases.test.tsx`           | Create | Verify phrase rotation with fake timers                                  |
| `packages/ui/src/components/chat/index.ts`                 | Modify | Re-export the new component                                              |
| `packages/ui/src/components/chat/chat-message-list.tsx`    | Modify | Render `ChatLoadingPhrases` when assistant is streaming with empty parts |
| `packages/ui/test/chat-message-list.test.tsx`              | Modify | Cover the new loading-state branch                                       |

---

## Task 1: Add `messages` parameter to `buildAgentsPayload`

**Files:**

- Modify: `apps/web/src/lib/chat/agents-payload.ts`
- Modify: `apps/web/test/agents-payload.test.ts`

- [ ] **Step 1: Add failing test for `messages` field**

Open `apps/web/test/agents-payload.test.ts` and add a second `it(...)` block inside the existing `describe("buildAgentsPayload", ...)`:

```typescript
it('includes the conversation messages in the payload', () => {
  const payload = buildAgentsPayload({
    chatId: '11111111-1111-1111-1111-111111111111',
    workspaceId: '22222222-2222-2222-2222-222222222222',
    userId: '33333333-3333-3333-3333-333333333333',
    text: 'follow up question',
    messages: [
      { role: 'user', content: 'first user message' },
      { role: 'assistant', content: 'previous answer' },
    ],
    settings: {
      temperature: 0,
      topP: 0,
      systemPrompt: 'sys',
      defaultModel: {
        slug: 'model',
        provider: { slug: 'provider', connection: {} },
      },
    },
  })

  expect(payload.messages).toEqual([
    { role: 'user', content: 'first user message' },
    { role: 'assistant', content: 'previous answer' },
  ])
})

it('defaults messages to an empty array when omitted', () => {
  const payload = buildAgentsPayload({
    chatId: '11111111-1111-1111-1111-111111111111',
    workspaceId: '22222222-2222-2222-2222-222222222222',
    userId: '33333333-3333-3333-3333-333333333333',
    text: 'hello',
    settings: {
      temperature: 0,
      topP: 0,
      systemPrompt: 'sys',
      defaultModel: {
        slug: 'model',
        provider: { slug: 'provider', connection: {} },
      },
    },
  })

  expect(payload.messages).toEqual([])
})
```

- [ ] **Step 2: Run the failing tests**

Run: `pnpm --filter web test -- agents-payload`
Expected: 2 new tests fail because `payload.messages` is `undefined`.

- [ ] **Step 3: Implement `messages` in `agents-payload.ts`**

Open `apps/web/src/lib/chat/agents-payload.ts`. Add a new exported type at the top (after `WorkspaceSettingsSnapshot`) and update `buildAgentsPayload`:

```typescript
export type AgentConversationMessage = {
  role: 'user' | 'assistant'
  content: string
}

export function buildAgentsPayload(args: {
  chatId: string
  workspaceId: string
  userId: string
  text: string
  settings: WorkspaceSettingsSnapshot
  messages?: AgentConversationMessage[]
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
    systemPrompt: args.settings.systemPrompt ?? '',
    messages: args.messages ?? [],
    mcp: {
      servers: [
        {
          name: 'AnyNote MCP Server',
          url: process.env.ANYNOTE_MCP_URL ?? 'http://localhost:8090/api/mcp',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'X-User-Id': args.userId,
            'X-Workspace-Id': args.workspaceId,
          },
          retries: 3,
          verify: false,
        },
      ],
    },
    instruction: {
      format: 'markdown',
      language: 'ru',
      citationsRequired: true,
    },
    query: args.text,
  }
}
```

The role values are lowercase to match Pydantic `RoleEnum` (`StrEnum` with `auto()` produces `"user"`/`"assistant"`).

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter web test -- agents-payload`
Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/chat/agents-payload.ts apps/web/test/agents-payload.test.ts
git commit -m "feat(chat): accept messages history in buildAgentsPayload"
```

---

## Task 2: Create chat history fetcher

**Files:**

- Create: `apps/web/src/lib/chat/chat-history.ts`
- Create: `apps/web/test/chat-history.test.ts`

### Slicing rules (verbatim from spec)

- Current chat (`parentId === null` or any chat node we're acting on): take `first message + last 10 messages`. The "last 10" excludes the first by id, so a chat with ≤11 messages returns all messages once de-duplicated.
- Each ancestor in the parent chain: take `first message + last 4 messages` with the same dedup rule.
- Order in returned array: root ancestor first → current chat last; within a chat, ascending by `createdAt`.
- Filter: only `status === "DONE"` messages, only `role` of `USER` or `ASSISTANT`, only those with non-empty extracted text.
- Walk safety: cap at 50 ancestors to avoid pathological loops.

- [ ] **Step 1: Write failing tests**

Create `apps/web/test/chat-history.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { buildChatHistoryMessages } from '../src/lib/chat/chat-history'

type ChatRow = { id: string; parentId: string | null; workspaceId: string }
type MessageRow = {
  id: string
  role: 'USER' | 'ASSISTANT'
  status: 'STREAMING' | 'DONE' | 'ERROR'
  parts: unknown
  createdAt: Date
}

function textPart(text: string) {
  return { type: 'text', text }
}

function makeMessages(count: number, role: 'USER' | 'ASSISTANT' = 'USER'): MessageRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `msg-${index}`,
    role,
    status: 'DONE' as const,
    parts: [textPart(`m${index}`)],
    createdAt: new Date(2026, 3, 1, 0, index),
  }))
}

function createPrismaMock(args: {
  chats: ChatRow[]
  messagesByChat: Record<string, MessageRow[]>
}) {
  return {
    chat: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; workspaceId?: string } }) => {
        return args.chats.find((c) => c.id === where.id) ?? null
      }),
    },
    chatMessage: {
      findMany: vi.fn(async ({ where }: { where: { chatId: string; status?: string } }) => {
        const all = args.messagesByChat[where.chatId] ?? []
        return where.status ? all.filter((m) => m.status === where.status) : all
      }),
    },
  }
}

describe('buildChatHistoryMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array when chat has no messages', async () => {
    const prisma = createPrismaMock({
      chats: [{ id: 'c1', parentId: null, workspaceId: 'w' }],
      messagesByChat: { c1: [] },
    })

    const result = await buildChatHistoryMessages({
      prisma: prisma as never,
      chatId: 'c1',
      workspaceId: 'w',
    })

    expect(result).toEqual([])
  })

  it('returns the single message for a 1-message chat', async () => {
    const messages = makeMessages(1, 'USER')
    const prisma = createPrismaMock({
      chats: [{ id: 'c1', parentId: null, workspaceId: 'w' }],
      messagesByChat: { c1: messages },
    })

    const result = await buildChatHistoryMessages({
      prisma: prisma as never,
      chatId: 'c1',
      workspaceId: 'w',
    })

    expect(result).toEqual([{ role: 'user', content: 'm0' }])
  })

  it('returns all messages when count <= 1 + lastN (no parent, count = 5)', async () => {
    const messages = makeMessages(5, 'USER')
    const prisma = createPrismaMock({
      chats: [{ id: 'c1', parentId: null, workspaceId: 'w' }],
      messagesByChat: { c1: messages },
    })

    const result = await buildChatHistoryMessages({
      prisma: prisma as never,
      chatId: 'c1',
      workspaceId: 'w',
    })

    expect(result.map((m) => m.content)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4'])
  })

  it('returns first + last 10 with no overlap (no parent, count = 15)', async () => {
    const messages = makeMessages(15, 'USER')
    const prisma = createPrismaMock({
      chats: [{ id: 'c1', parentId: null, workspaceId: 'w' }],
      messagesByChat: { c1: messages },
    })

    const result = await buildChatHistoryMessages({
      prisma: prisma as never,
      chatId: 'c1',
      workspaceId: 'w',
    })

    expect(result.map((m) => m.content)).toEqual([
      'm0',
      'm5',
      'm6',
      'm7',
      'm8',
      'm9',
      'm10',
      'm11',
      'm12',
      'm13',
      'm14',
    ])
  })

  it('walks parent chain root → current with correct slicing per chat', async () => {
    const root = makeMessages(8, 'USER').map((m, i) => ({
      ...m,
      id: `root-${i}`,
      parts: [textPart(`root${i}`)],
    }))
    const middle = makeMessages(8, 'USER').map((m, i) => ({
      ...m,
      id: `mid-${i}`,
      parts: [textPart(`mid${i}`)],
    }))
    const current = makeMessages(15, 'USER').map((m, i) => ({
      ...m,
      id: `cur-${i}`,
      parts: [textPart(`cur${i}`)],
    }))

    const prisma = createPrismaMock({
      chats: [
        { id: 'root', parentId: null, workspaceId: 'w' },
        { id: 'mid', parentId: 'root', workspaceId: 'w' },
        { id: 'cur', parentId: 'mid', workspaceId: 'w' },
      ],
      messagesByChat: { root, mid: middle, cur: current },
    })

    const result = await buildChatHistoryMessages({
      prisma: prisma as never,
      chatId: 'cur',
      workspaceId: 'w',
    })

    // root: first + last 4 = root0, root4, root5, root6, root7
    // mid: first + last 4 = mid0, mid4, mid5, mid6, mid7
    // cur: first + last 10 = cur0, cur5, cur6, cur7, cur8, cur9, cur10, cur11, cur12, cur13, cur14
    expect(result.map((m) => m.content)).toEqual([
      'root0',
      'root4',
      'root5',
      'root6',
      'root7',
      'mid0',
      'mid4',
      'mid5',
      'mid6',
      'mid7',
      'cur0',
      'cur5',
      'cur6',
      'cur7',
      'cur8',
      'cur9',
      'cur10',
      'cur11',
      'cur12',
      'cur13',
      'cur14',
    ])
  })

  it('maps role USER → user, ASSISTANT → assistant', async () => {
    const messages: MessageRow[] = [
      {
        id: 'u',
        role: 'USER',
        status: 'DONE',
        parts: [textPart('hi')],
        createdAt: new Date(2026, 3, 1, 0, 0),
      },
      {
        id: 'a',
        role: 'ASSISTANT',
        status: 'DONE',
        parts: [textPart('hello')],
        createdAt: new Date(2026, 3, 1, 0, 1),
      },
    ]
    const prisma = createPrismaMock({
      chats: [{ id: 'c', parentId: null, workspaceId: 'w' }],
      messagesByChat: { c: messages },
    })

    const result = await buildChatHistoryMessages({
      prisma: prisma as never,
      chatId: 'c',
      workspaceId: 'w',
    })

    expect(result).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ])
  })

  it('skips messages with no extractable text', async () => {
    const messages: MessageRow[] = [
      {
        id: '1',
        role: 'USER',
        status: 'DONE',
        parts: [textPart('real')],
        createdAt: new Date(2026, 3, 1, 0, 0),
      },
      {
        id: '2',
        role: 'ASSISTANT',
        status: 'DONE',
        parts: [{ type: 'tool', id: 't1', kind: 'tool', state: 'done', title: 'ran' }],
        createdAt: new Date(2026, 3, 1, 0, 1),
      },
      {
        id: '3',
        role: 'USER',
        status: 'DONE',
        parts: [textPart('   ')],
        createdAt: new Date(2026, 3, 1, 0, 2),
      },
    ]
    const prisma = createPrismaMock({
      chats: [{ id: 'c', parentId: null, workspaceId: 'w' }],
      messagesByChat: { c: messages },
    })

    const result = await buildChatHistoryMessages({
      prisma: prisma as never,
      chatId: 'c',
      workspaceId: 'w',
    })

    expect(result).toEqual([{ role: 'user', content: 'real' }])
  })

  it('only loads DONE messages from prisma (filters STREAMING / ERROR)', async () => {
    const prisma = createPrismaMock({
      chats: [{ id: 'c', parentId: null, workspaceId: 'w' }],
      messagesByChat: { c: [] },
    })

    await buildChatHistoryMessages({
      prisma: prisma as never,
      chatId: 'c',
      workspaceId: 'w',
    })

    expect(prisma.chatMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ chatId: 'c', status: 'DONE' }),
      }),
    )
  })

  it('scopes ancestor lookups to the same workspaceId', async () => {
    const prisma = createPrismaMock({
      chats: [
        { id: 'root', parentId: null, workspaceId: 'w' },
        { id: 'cur', parentId: 'root', workspaceId: 'w' },
      ],
      messagesByChat: { root: [], cur: [] },
    })

    await buildChatHistoryMessages({
      prisma: prisma as never,
      chatId: 'cur',
      workspaceId: 'w',
    })

    expect(prisma.chat.findFirst).toHaveBeenCalledWith({
      where: { id: 'root', workspaceId: 'w' },
      select: { id: true, parentId: true },
    })
  })

  it('concatenates the last 10 messages including first when count = 11', async () => {
    const messages = makeMessages(11, 'USER')
    const prisma = createPrismaMock({
      chats: [{ id: 'c1', parentId: null, workspaceId: 'w' }],
      messagesByChat: { c1: messages },
    })

    const result = await buildChatHistoryMessages({
      prisma: prisma as never,
      chatId: 'c1',
      workspaceId: 'w',
    })

    expect(result.map((m) => m.content)).toEqual([
      'm0',
      'm1',
      'm2',
      'm3',
      'm4',
      'm5',
      'm6',
      'm7',
      'm8',
      'm9',
      'm10',
    ])
  })
})
```

- [ ] **Step 2: Run failing tests**

Run: `pnpm --filter web test -- chat-history`
Expected: every test fails because `apps/web/src/lib/chat/chat-history.ts` does not exist (import error).

- [ ] **Step 3: Implement `chat-history.ts`**

Create `apps/web/src/lib/chat/chat-history.ts`:

```typescript
import type { Prisma, PrismaClient } from '@repo/db'

import type { AgentConversationMessage } from './agents-payload'

const MAX_ANCESTORS = 50
const CURRENT_CHAT_LAST_COUNT = 10
const ANCESTOR_LAST_COUNT = 4

type MessageRow = {
  id: string
  role: 'USER' | 'ASSISTANT'
  parts: Prisma.JsonValue
  createdAt: Date
}

type PrismaLike = {
  chat: {
    findFirst: PrismaClient['chat']['findFirst']
  }
  chatMessage: {
    findMany: PrismaClient['chatMessage']['findMany']
  }
}

function isTextPart(value: unknown): value is { type: 'text'; text: string } {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'text' &&
    typeof (value as { text?: unknown }).text === 'string'
  )
}

function extractText(parts: Prisma.JsonValue): string {
  if (!Array.isArray(parts)) {
    return ''
  }
  return parts
    .filter(isTextPart)
    .map((part) => part.text)
    .join('\n\n')
    .trim()
}

function pickHistory(messages: MessageRow[], lastCount: number): MessageRow[] {
  if (messages.length === 0) {
    return []
  }
  if (messages.length <= 1 + lastCount) {
    return messages
  }
  const first = messages[0]!
  const tail = messages.slice(-lastCount).filter((m) => m.id !== first.id)
  return [first, ...tail]
}

function mapRole(role: 'USER' | 'ASSISTANT'): AgentConversationMessage['role'] {
  return role === 'USER' ? 'user' : 'assistant'
}

export async function buildChatHistoryMessages(args: {
  prisma: PrismaLike
  chatId: string
  workspaceId: string
}): Promise<AgentConversationMessage[]> {
  const chain: string[] = []
  let cursorId: string | null = args.chatId
  let depth = 0

  while (cursorId && depth < MAX_ANCESTORS) {
    const node = await args.prisma.chat.findFirst({
      where: { id: cursorId, workspaceId: args.workspaceId },
      select: { id: true, parentId: true },
    })
    if (!node) {
      break
    }
    chain.unshift(node.id)
    cursorId = node.parentId
    depth += 1
  }

  const conversation: AgentConversationMessage[] = []

  for (let i = 0; i < chain.length; i += 1) {
    const isCurrent = i === chain.length - 1
    const lastCount = isCurrent ? CURRENT_CHAT_LAST_COUNT : ANCESTOR_LAST_COUNT

    const messages = (await args.prisma.chatMessage.findMany({
      where: { chatId: chain[i], status: 'DONE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, parts: true, createdAt: true },
    })) as MessageRow[]

    const picked = pickHistory(messages, lastCount)
    for (const message of picked) {
      const content = extractText(message.parts)
      if (!content) continue
      conversation.push({ role: mapRole(message.role), content })
    }
  }

  return conversation
}
```

- [ ] **Step 4: Run the tests until green**

Run: `pnpm --filter web test -- chat-history`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/chat/chat-history.ts apps/web/test/chat-history.test.ts
git commit -m "feat(chat): collect parent-aware chat history for agents"
```

---

## Task 3: Wire history into the POST `/api/agents/generate` route

**Files:**

- Modify: `apps/web/src/app/api/agents/generate/route.ts`
- Modify: `apps/web/test/api-agents-generate.test.ts`

### Order-of-operations note

History MUST be fetched **before** the `prisma.$transaction` that creates the new user/assistant messages. The new user message text is already in `body.text` and travels through `query`, so including it again under `messages` would duplicate the prompt.

- [ ] **Step 1: Update the route test to assert messages are forwarded**

Open `apps/web/test/api-agents-generate.test.ts`. Find the existing `mocks` block (the `vi.hoisted(() => {...})` near the top) and extend the prisma mock so `chatMessage` exposes `findMany` and the chat mock returns `parentId`. Add a `globalThis.fetch` capture so we can assert the body sent to the agents service:

In the `mocks = vi.hoisted(...)` object, change the `prisma.chatMessage` shape from:

```typescript
chatMessage: { update: vi.fn() },
```

to:

```typescript
chatMessage: { update: vi.fn(), findMany: vi.fn() },
```

Then inside the existing `it('returns SSE events for a successful start flow', ...)`, after the `mocks.prisma.chat.findFirst.mockResolvedValue({ id: chatId, title: 'Новый чат', workspaceId })` line, change it to also include `parentId: null`:

```typescript
mocks.prisma.chat.findFirst.mockResolvedValue({
  id: chatId,
  title: 'Новый чат',
  workspaceId,
  parentId: null,
})
```

Add immediately after it:

```typescript
mocks.prisma.chatMessage.findMany.mockResolvedValue([
  {
    id: 'prev-1',
    role: 'USER',
    parts: [{ type: 'text', text: 'previous question' }],
    createdAt: new Date('2026-04-25T10:00:00Z'),
  },
  {
    id: 'prev-2',
    role: 'ASSISTANT',
    parts: [{ type: 'text', text: 'previous answer' }],
    createdAt: new Date('2026-04-25T10:01:00Z'),
  },
])
```

Then capture `fetch` calls. Near the top of the same `it(...)` (before invoking `POST`), add:

```typescript
const fetchMock = vi.fn().mockResolvedValue(
  new Response(
    new ReadableStream({
      start(controller) {
        controller.close()
      },
    }),
    {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    },
  ),
)
vi.stubGlobal('fetch', fetchMock)
```

And after the existing assertions (after `expect(...)` calls), add:

```typescript
const upstreamCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/chat/generate'))
expect(upstreamCall).toBeDefined()
const sentBody = JSON.parse(upstreamCall![1].body as string)
expect(sentBody.messages).toEqual([
  { role: 'user', content: 'previous question' },
  { role: 'assistant', content: 'previous answer' },
])
```

If a chat-message `findMany` call is made on the second create (the new user message after the transaction), make sure the mock only returns the prev rows when called with `where.chatId === chatId && where.status === 'DONE'`. The simplest approach is `mockImplementation` that filters; the simpler `mockResolvedValue` above works because the new user/assistant rows are written via `tx.chatMessage.create`, not `findMany`.

- [ ] **Step 2: Run the test to confirm failure**

Run: `pnpm --filter web test -- api-agents-generate`
Expected: assertion on `sentBody.messages` fails because the route does not forward messages yet.

- [ ] **Step 3: Modify `route.ts` to fetch + forward history**

Open `apps/web/src/app/api/agents/generate/route.ts`.

(a) Add an import at the top:

```typescript
import { buildChatHistoryMessages } from '@/lib/chat/chat-history'
import type { AgentConversationMessage } from '@/lib/chat/agents-payload'
```

(b) Extend `streamAgentsToRegistry` argument type to take `messages` and forward to `buildAgentsPayload`. Find the function signature:

```typescript
async function streamAgentsToRegistry(args: {
  assistantMessageId: string
  chatId: string
  entry: ReturnType<typeof activeStreamRegistry.create>
  text: string
  userId: string
  workspaceId: string
  settings: WorkspaceSettingsSnapshot
}) {
```

Change to:

```typescript
async function streamAgentsToRegistry(args: {
  assistantMessageId: string
  chatId: string
  entry: ReturnType<typeof activeStreamRegistry.create>
  text: string
  userId: string
  workspaceId: string
  settings: WorkspaceSettingsSnapshot
  messages: AgentConversationMessage[]
}) {
```

And inside it, find the `buildAgentsPayload({...})` call and add `messages: args.messages,`:

```typescript
body: JSON.stringify(
  buildAgentsPayload({
    chatId: args.chatId,
    settings: args.settings,
    text: args.text,
    userId: args.userId,
    workspaceId: args.workspaceId,
    messages: args.messages,
  }),
),
```

(c) Update the chat lookup `select` block in `POST`. Find:

```typescript
const chat = await prisma.chat.findFirst({
  where: {
    id: body.chatId,
    workspace: { members: { some: { userId: session.user.id } } },
  },
  select: { id: true, title: true, workspaceId: true },
})
```

Change `select` to include `parentId`:

```typescript
  select: { id: true, title: true, workspaceId: true, parentId: true },
```

(d) After the chat existence check (right after `if (!chat) { return ... 404 ... }`), insert the history fetch (this MUST be **before** the `$transaction`):

```typescript
const historyMessages = await buildChatHistoryMessages({
  prisma,
  chatId: chat.id,
  workspaceId: chat.workspaceId,
})
```

(e) In the `streamAgentsToRegistry({...})` call near the end of `POST`, pass `messages: historyMessages`:

```typescript
const upstreamTask = streamAgentsToRegistry({
  assistantMessageId: assistantMessage.id,
  chatId: chat.id,
  entry,
  settings: settingsSnapshot,
  text: body.text,
  userId: session.user.id,
  workspaceId: chat.workspaceId,
  messages: historyMessages,
})
```

- [ ] **Step 4: Re-run the route test**

Run: `pnpm --filter web test -- api-agents-generate`
Expected: pass — `sentBody.messages` matches the prev-questions/answers.

- [ ] **Step 5: Run the whole web test suite to catch regressions**

Run: `pnpm --filter web test`
Expected: all tests pass.

- [ ] **Step 6: Type-check**

Run: `pnpm --filter web check-types`
Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/api/agents/generate/route.ts apps/web/test/api-agents-generate.test.ts
git commit -m "feat(chat): forward chat history to agents /chat/generate"
```

---

## Task 4: Add rotating loading-phrase placeholder for streaming assistant bubble

**Files:**

- Create: `packages/ui/src/components/chat/chat-loading-phrases.tsx`
- Create: `packages/ui/test/chat-loading-phrases.test.tsx`
- Modify: `packages/ui/src/components/chat/index.ts`
- Modify: `packages/ui/src/components/chat/chat-message-list.tsx`
- Modify: `packages/ui/test/chat-message-list.test.tsx`

### Behaviour

- Render a single Typography that reads `Загрузка → Вычисления → Преобразование → Литье` (verbatim from spec; no "ё") on a 1000 ms interval, looping.
- Render only when `message.role === "assistant" && message.status === "streaming" && message.parts.length === 0`.
- As soon as parts arrive (text or tool blocks), the existing `ChatMessageContent` takes over.

- [ ] **Step 1: Write failing test for `ChatLoadingPhrases`**

Create `packages/ui/test/chat-loading-phrases.test.tsx`:

```typescript
import { render, screen, act } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ChatLoadingPhrases } from "../src/components/chat/chat-loading-phrases"

describe("ChatLoadingPhrases", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("starts with the first phrase", () => {
    render(<ChatLoadingPhrases />)
    expect(screen.getByText("Загрузка")).toBeTruthy()
  })

  it("rotates phrases every 1000 ms", () => {
    render(<ChatLoadingPhrases />)
    expect(screen.getByText("Загрузка")).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText("Вычисления")).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText("Преобразование")).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText("Литье")).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText("Загрузка")).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run failing test**

Run: `pnpm --filter @repo/ui test -- chat-loading-phrases`
Expected: import error / file does not exist.

- [ ] **Step 3: Implement `ChatLoadingPhrases`**

Create `packages/ui/src/components/chat/chat-loading-phrases.tsx`:

```typescript
"use client"

import Typography from "@mui/material/Typography"
import { useEffect, useState } from "react"

const LOADING_PHRASES = ["Загрузка", "Вычисления", "Преобразование", "Литье"] as const

export function ChatLoadingPhrases() {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((current) => (current + 1) % LOADING_PHRASES.length)
    }, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <Typography color="text.secondary" suppressHydrationWarning variant="body2">
      {LOADING_PHRASES[index]}
    </Typography>
  )
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter @repo/ui test -- chat-loading-phrases`
Expected: both tests pass.

- [ ] **Step 5: Export from chat barrel**

Open `packages/ui/src/components/chat/index.ts` and add the new export between `chat-file-chip` and `chat-message-content`:

```typescript
export * from './chat-composer'
export * from './chat-empty-state'
export * from './chat-file-chip'
export * from './chat-loading-phrases'
export * from './chat-message-content'
export * from './chat-message-list'
export * from './chat-service-block'
export * from './chat-thread'
export * from './chat-types'
```

- [ ] **Step 6: Add failing test in `chat-message-list.test.tsx` for the new branch**

Open `packages/ui/test/chat-message-list.test.tsx`. Add a new test inside the existing `describe`:

```typescript
  it("shows loading phrases for an assistant message that is streaming with empty parts", () => {
    render(
      <ChatMessageList
        messages={[
          {
            id: "assistant-empty-streaming",
            parts: [],
            role: "assistant",
            status: "streaming",
          },
        ]}
      />,
    )

    expect(screen.getByText("Загрузка")).toBeTruthy()
  })

  it("does not show loading phrases once the assistant has produced text", () => {
    render(
      <ChatMessageList
        messages={[
          {
            id: "assistant-text-streaming",
            parts: [{ type: "text", text: "Уже что-то есть" }],
            role: "assistant",
            status: "streaming",
          },
        ]}
      />,
    )

    expect(screen.queryByText("Загрузка")).toBeNull()
    expect(screen.getByText("Уже что-то есть")).toBeTruthy()
  })
```

- [ ] **Step 7: Run failing tests**

Run: `pnpm --filter @repo/ui test -- chat-message-list`
Expected: the new "shows loading phrases" test fails because the list still renders an empty `ChatMessageContent`.

- [ ] **Step 8: Wire `ChatLoadingPhrases` into `ChatMessageList`**

Open `packages/ui/src/components/chat/chat-message-list.tsx`. Add an import alongside the others:

```typescript
import { ChatLoadingPhrases } from './chat-loading-phrases'
```

Find the line that renders `<ChatMessageContent parts={message.parts} />` inside the `renderItem` callback. Replace that single line with a conditional:

```typescript
                    {message.role === "assistant" &&
                    message.status === "streaming" &&
                    message.parts.length === 0 ? (
                      <ChatLoadingPhrases />
                    ) : (
                      <ChatMessageContent parts={message.parts} />
                    )}
```

- [ ] **Step 9: Run the UI suite to verify all green**

Run: `pnpm --filter @repo/ui test`
Expected: all tests pass.

- [ ] **Step 10: Type-check the UI package**

Run: `pnpm --filter @repo/ui check-types`
Expected: pass.

- [ ] **Step 11: Manual UI verification**

Make sure infrastructure is up. From the repo root:

```bash
docker compose up -d
pnpm --filter @repo/yjs-server dev &     # or in another terminal
pnpm --filter web dev
```

Open `http://localhost:3000`, log in, open a chat in any workspace, send a message, and visually confirm:

- Before the first token arrives, the assistant bubble shows rotating phrases (Загрузка → Вычисления → Преобразование → Литье) cycling once per second.
- Once tokens stream, the markdown text replaces the placeholder.

- [ ] **Step 12: Commit**

```bash
git add packages/ui/src/components/chat/chat-loading-phrases.tsx \
        packages/ui/test/chat-loading-phrases.test.tsx \
        packages/ui/src/components/chat/index.ts \
        packages/ui/src/components/chat/chat-message-list.tsx \
        packages/ui/test/chat-message-list.test.tsx
git commit -m "feat(ui): rotate loading phrases while assistant is streaming"
```

---

## Task 5: Re-run the RAG Playwright test to verify block-anchor links

**Files:** none modified.

The existing `apps/e2e/rag-block-links.spec.ts` already:

- Seeds a workspace + page (with the marker `Бразильский Медведь` in block #2)
- Sends a chat query through the UI
- Polls until the marker appears in any assistant article
- Asserts a link `<a href="/workspaces/{workspaceId}/pages/{pageId}#2">` is visible

We re-run it after the changes to confirm the new `messages` field and loading-phrase UI did not regress citation rendering.

- [ ] **Step 1: Bring up infrastructure**

```bash
docker compose up -d
```

Verify Postgres, MinIO, Qdrant, Ollama are healthy:

```bash
docker compose ps
```

- [ ] **Step 2: Start the dev server (Next.js + agents + engines + yjs)**

In one terminal:

```bash
pnpm dev
```

Wait for Next on `http://localhost:3000`, agents on `http://localhost:8080`, engines, and yjs (`ws://localhost:1234`) to all be ready.

- [ ] **Step 3: Run the spec**

```bash
pnpm exec playwright test apps/e2e/rag-block-links.spec.ts
```

Expected: `1 passed`. The test verifies:

- Marker text appears in an assistant `[role="article"]`
- The `<a>` tag pointing to `/workspaces/{wsId}/pages/{pageId}#2` is present in the DOM

If the test fails because of LLM non-determinism (GigaChat-2 occasionally hallucinates), retry once. Real failures look like missing block anchor or page not vectorized.

- [ ] **Step 4: Run the broader chat e2e to catch regressions**

```bash
pnpm exec playwright test apps/e2e/chat-page.spec.ts
```

Expected: pass.

- [ ] **Step 5: No commit needed (no file changes)**

---

## Self-review notes

- **Spec coverage:**
  - "messages history sent in QueryRequestSchema" → Tasks 1 & 3 add the field; Task 2 builds the array per the rules.
  - "current chat first + last 10 (excluding first)" → Task 2 unit tests cover counts 1, 5, 11, 15.
  - "ancestor chats first + last 4 each, walking parent chain" → Task 2 includes a 3-level chain test.
  - "added to apps/web/src/lib/chat/agents-payload.ts request" → Task 1 modifies that file; Task 3 wires it.
  - "loading phrases (Загрузка / Вычисления / Преобразование / Литье) cycling every 1s in empty assistant bubble" → Task 4 component + integration in `ChatMessageList`.
  - "stop showing phrases when streaming begins" → Task 4 conditional on `parts.length === 0`.
  - "Playwright test confirming block-anchor links" → Task 5 runs the existing spec.

- **Placeholder scan:** all steps include actual code blocks; no TBD/TODO.

- **Type consistency:** `AgentConversationMessage` type defined in Task 1 is imported by Tasks 2 & 3; `role` literal `"user"|"assistant"` matches Pydantic `RoleEnum` lowercase values.
