# Workspace Chat Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the MVP chat flow with a persistent, `@mui/x-chat`-based workspace chat that supports draft file uploads, normalized `ChatMessage.parts`, structured streaming from `apps/agents`, reload-safe stream continuation, and removal of the legacy `trpc.chat.sendMessage` path.

**Architecture:** Prisma remains the durable source of truth (`Chat`, `ChatMessage`, `ChatMessageFile`, `File`). `packages/ui` provides reusable chat components built on top of `@mui/x-chat`. `packages/trpc` returns chat DTOs already normalized into `parts`. `apps/web` owns send orchestration, active-stream registry, start/resume SSE routes, and client-side rehydration. `apps/agents` upgrades its SSE output to emit structured `token` and `status` events.

**Tech Stack:** Prisma 7, PostgreSQL, Next.js 16 App Router, React 19, tRPC 11, MUI 6 + `@mui/x-chat`, Vitest 3 + Testing Library, FastAPI, pytest.

**Reference spec:** [`docs/superpowers/specs/2026-04-22-workspace-chat-streaming-design.md`](../specs/2026-04-22-workspace-chat-streaming-design.md)

---

## File Structure

### Database and Prisma

| Path                                                                                       | Responsibility                                       | Task |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ---- |
| `packages/db/prisma/schema.prisma`                                                         | Add `ChatMessageStatus`, `updatedAt`, `errorMessage` | T1   |
| `packages/db/prisma/migrations/20260422093000_chat_message_streaming_status/migration.sql` | Persist enum + columns + backfill                    | T1   |

### `packages/ui`

| Path                                                         | Responsibility                                                           | Task |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ | ---- |
| `packages/ui/package.json`                                   | Add `@mui/x-chat` + test tooling                                         | T2   |
| `packages/ui/src/components/index.ts`                        | Re-export new chat components                                            | T2   |
| `packages/ui/src/components/chat/chat-types.ts`              | Shared AnyNote chat DTO and transient service-block types                | T2   |
| `packages/ui/src/components/chat/mui-chat-augmentation.d.ts` | Register custom `file` and `service-status` parts for `@mui/x-chat`      | T2   |
| `packages/ui/src/components/chat/chat-thread.tsx`            | Thread shell composing list + composer under breadcrumbs page shell      | T2   |
| `packages/ui/src/components/chat/chat-message-list.tsx`      | Message list wrapper and item rendering                                  | T2   |
| `packages/ui/src/components/chat/chat-message-content.tsx`   | `parts` rendering for `text`, `file`, and transient `service-status`     | T2   |
| `packages/ui/src/components/chat/chat-composer.tsx`          | Plain-text composer with embedded attach/send icons and draft file chips | T2   |
| `packages/ui/src/components/chat/chat-file-chip.tsx`         | Draft attachment chip                                                    | T2   |
| `packages/ui/src/components/chat/chat-service-block.tsx`     | Tool/confirmation block inside assistant message                         | T2   |
| `packages/ui/src/components/chat/chat-empty-state.tsx`       | Empty-thread placeholder                                                 | T2   |
| `packages/ui/src/components/chat/index.ts`                   | Barrel export                                                            | T2   |
| `packages/ui/test/chat-message-content.test.tsx`             | Parts rendering contract tests                                           | T2   |
| `packages/ui/test/chat-composer.test.tsx`                    | Composer interaction tests                                               | T2   |
| `packages/ui/vitest.config.ts`                               | UI package test config                                                   | T2   |

### `packages/trpc`

| Path                                     | Responsibility                                               | Task |
| ---------------------------------------- | ------------------------------------------------------------ | ---- |
| `packages/trpc/package.json`             | Add test script/deps if missing                              | T3   |
| `packages/trpc/src/routers/chat.ts`      | Normalize messages to DTOs and delete `sendMessage` mutation | T3   |
| `packages/trpc/test/chat-router.test.ts` | Router normalization + removal regression tests              | T3   |
| `packages/trpc/vitest.config.ts`         | tRPC package test config                                     | T3   |

### `apps/agents`

| Path                                                        | Responsibility                                                                                | Task |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---- |
| `apps/agents/agents/apps/chat/schemas.py`                   | Extend `ServerEvent` with structured `status` event payload                                   | T4   |
| `apps/agents/agents/apps/chat/use_cases/generate_stream.py` | Emit `status` events for tool/confirmation updates instead of flattening them into plain text | T4   |
| `apps/agents/tests/apps/chat/test_generate_stream.py`       | SSE event-shape regression tests                                                              | T4   |

### `apps/web` server-side

| Path                                                                | Responsibility                                                                 | Task |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---- |
| `apps/web/package.json`                                             | Add test script/deps if missing                                                | T5   |
| `apps/web/src/lib/chat/types.ts`                                    | Shared web-layer SSE and registry types                                        | T5   |
| `apps/web/src/lib/chat/active-stream-registry.ts`                   | Process-local upstream fan-out + debounced persistence                         | T5   |
| `apps/web/src/lib/chat/agents-payload.ts`                           | Build `/chat/generate` payload from `Chat`, `WorkspaceAiSettings`, and session | T5   |
| `apps/web/src/lib/chat/sse.ts`                                      | SSE frame encode/decode helpers                                                | T5   |
| `apps/web/src/app/api/agents/generate/route.ts`                     | Start message transaction + registry-backed SSE                                | T5   |
| `apps/web/src/app/api/agents/streams/[assistantMessageId]/route.ts` | Resume active stream after reload                                              | T5   |
| `apps/web/test/active-stream-registry.test.ts`                      | Registry fan-out and flush tests                                               | T5   |
| `apps/web/test/api-agents-generate.test.ts`                         | Start-route contract tests                                                     | T5   |
| `apps/web/vitest.config.ts`                                         | Web package test config                                                        | T5   |

### `apps/web` client-side

| Path                                                                            | Responsibility                                       | Task |
| ------------------------------------------------------------------------------- | ---------------------------------------------------- | ---- |
| `apps/web/src/components/workspace/chat/workspace-chat-client.tsx`              | Main client orchestrator for read/send/stream/resume | T6   |
| `apps/web/src/components/workspace/chat/use-chat-stream.ts`                     | Browser-side SSE state reducer                       | T6   |
| `apps/web/src/components/workspace/chat/use-draft-attachments.ts`               | Upload/remove draft attachment state                 | T6   |
| `apps/web/src/components/workspace/chat/chat-message-mappers.ts`                | Convert tRPC DTOs to `@repo/ui` chat props           | T6   |
| `apps/web/src/app/(protected)/workspaces/[workspaceId]/chats/[chatId]/page.tsx` | Swap out legacy `SearchChatView`                     | T6   |
| `apps/web/src/components/workspace/search/search-chat-view.tsx`                 | Delete from active path or remove file entirely      | T6   |
| `apps/web/src/components/workspace/search/search-chat-input.tsx`                | Delete from active path or remove file entirely      | T6   |
| `apps/web/test/workspace-chat-client.test.tsx`                                  | Client reload/send reducer tests                     | T6   |

### Verification

| Path                                                                   | Responsibility                                        | Task |
| ---------------------------------------------------------------------- | ----------------------------------------------------- | ---- |
| `apps/agents/requests.http`                                            | Update sample request to the final contract if needed | T7   |
| `docs/superpowers/specs/2026-04-22-workspace-chat-streaming-design.md` | No changes expected; reference only                   | T7   |

---

## Task 0: Baseline verification

**Files:** none modified.

- [ ] **Step 0.1: Confirm working tree and current branch state**

```bash
cd /Users/victor/Projects/anynote
git status --short
git log --oneline -3
```

Expected: existing unrelated changes are understood and left alone. `cbcc811 docs: add workspace chat streaming design spec` is present near HEAD.

- [ ] **Step 0.2: Verify current repo gates before touching code**

```bash
pnpm check-types
pnpm lint
pnpm build
```

Expected: green baseline or clearly identified pre-existing failures. If the baseline is already red, STOP and record the exact failing package before proceeding.

- [ ] **Step 0.3: No commit in this task**

---

## Task 1: Prisma schema and migration for streaming status

Add durable assistant stream state to `ChatMessage`.

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260422093000_chat_message_streaming_status/migration.sql`

- [ ] **Step 1.1: Update `schema.prisma`**

Add the enum and extend `ChatMessage`:

```prisma
enum ChatMessageStatus {
  STREAMING
  DONE
  ERROR
}

model ChatMessage {
  id           String            @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  chatId       String            @map("chat_id") @db.Uuid
  role         ChatMessageRole
  status       ChatMessageStatus @default(DONE)
  content      String            @db.Text
  sources      Json              @default("[]")
  errorMessage String?           @map("error_message") @db.Text
  createdAt    DateTime          @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime          @updatedAt @map("updated_at") @db.Timestamptz(6)

  chat  Chat              @relation(fields: [chatId], references: [id], onDelete: Cascade)
  files ChatMessageFile[]

  @@index([chatId, createdAt])
  @@index([chatId, status])
  @@map("chat_messages")
}
```

- [ ] **Step 1.2: Create the SQL migration**

Write `packages/db/prisma/migrations/20260422093000_chat_message_streaming_status/migration.sql`:

```sql
CREATE TYPE "ChatMessageStatus" AS ENUM ('STREAMING', 'DONE', 'ERROR');

ALTER TABLE "chat_messages"
  ADD COLUMN "status" "ChatMessageStatus" NOT NULL DEFAULT 'DONE',
  ADD COLUMN "error_message" TEXT,
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW();

UPDATE "chat_messages"
SET "updated_at" = "created_at"
WHERE "updated_at" IS NULL;

CREATE INDEX "chat_messages_chat_id_status_idx"
  ON "chat_messages" ("chat_id", "status");
```

- [ ] **Step 1.3: Regenerate Prisma client and verify type surface**

```bash
pnpm --filter @repo/db prisma:generate
pnpm --filter @repo/db check-types
```

Expected: Prisma client includes `ChatMessageStatus` and the DB package type-checks cleanly.

- [ ] **Step 1.4: Commit schema work**

```bash
git add packages/db/prisma/schema.prisma \
  packages/db/prisma/migrations/20260422093000_chat_message_streaming_status/migration.sql
git commit -m "feat: add chat message streaming status"
```

---

## Task 2: Build reusable chat UI in `@repo/ui`

Install `@mui/x-chat`, add test tooling, and create the reusable thread/composer/message components.

**Files:**

- Modify: `packages/ui/package.json`
- Modify: `packages/ui/src/components/index.ts`
- Create: `packages/ui/src/components/chat/chat-types.ts`
- Create: `packages/ui/src/components/chat/mui-chat-augmentation.d.ts`
- Create: `packages/ui/src/components/chat/chat-thread.tsx`
- Create: `packages/ui/src/components/chat/chat-message-list.tsx`
- Create: `packages/ui/src/components/chat/chat-message-content.tsx`
- Create: `packages/ui/src/components/chat/chat-composer.tsx`
- Create: `packages/ui/src/components/chat/chat-file-chip.tsx`
- Create: `packages/ui/src/components/chat/chat-service-block.tsx`
- Create: `packages/ui/src/components/chat/chat-empty-state.tsx`
- Create: `packages/ui/src/components/chat/index.ts`
- Create: `packages/ui/test/chat-message-content.test.tsx`
- Create: `packages/ui/test/chat-composer.test.tsx`
- Create: `packages/ui/vitest.config.ts`

- [ ] **Step 2.1: Add dependencies and test script**

Install the chat package directly so the lockfile resolves the exact compatible version:

```bash
pnpm --filter @repo/ui add @mui/x-chat
pnpm --filter @repo/ui add -D @testing-library/react @testing-library/user-event jsdom vitest
```

Update `packages/ui/package.json`:

```json
{
  "scripts": {
    "lint": "eslint . --max-warnings 0",
    "build": "tsc -p tsconfig.json",
    "check-types": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@testing-library/react": "^16.3.0",
    "@testing-library/user-event": "^14.6.1",
    "jsdom": "^26.1.0",
    "vitest": "^3.2.4"
  }
}
```

Keep the exact `@mui/x-chat` version resolved by `pnpm`.

- [ ] **Step 2.2: Write failing message-parts tests first**

Create `packages/ui/test/chat-message-content.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ChatMessageContent } from '../src/components/chat/chat-message-content'

describe('ChatMessageContent', () => {
  it('renders text before files', () => {
    render(
      <ChatMessageContent
        parts={[
          { type: 'text', text: 'Привет' },
          {
            type: 'file',
            fileId: 'f1',
            name: 'brief.pdf',
            mimeType: 'application/pdf',
            fileSize: '12',
            downloadUrl: '/api/files/f1',
          },
        ]}
      />,
    )

    expect(screen.getByText('Привет')).toBeInTheDocument()
    expect(screen.getByText('brief.pdf')).toBeInTheDocument()
  })
})
```

Create `packages/ui/test/chat-composer.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ChatComposer } from '../src/components/chat/chat-composer'

describe('ChatComposer', () => {
  it('disables send while the text area is empty', () => {
    render(<ChatComposer value="" attachments={[]} onValueChange={() => {}} onSend={vi.fn()} />)
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled()
  })

  it('calls onSend only when non-empty text exists', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(
      <ChatComposer value="Запрос" attachments={[]} onValueChange={() => {}} onSend={onSend} />,
    )
    await user.click(screen.getByRole('button', { name: /send/i }))
    expect(onSend).toHaveBeenCalledWith('Запрос')
  })
})
```

- [ ] **Step 2.3: Run tests to confirm they fail**

```bash
pnpm --filter @repo/ui test
```

Expected: fail because the new chat components and vitest config do not exist yet.

- [ ] **Step 2.4: Add shared types and MUI part augmentation**

Create `packages/ui/src/components/chat/chat-types.ts`:

```ts
export type ChatFilePart = {
  type: 'file'
  fileId: string
  name: string
  mimeType: string
  fileSize: string
  downloadUrl: string
}

export type ChatTextPart = {
  type: 'text'
  text: string
}

export type ChatServiceBlock = {
  id: string
  kind: 'tool' | 'confirmation'
  state: 'pending' | 'running' | 'done' | 'error' | 'required'
  title: string
  detail?: string
}
```

Create `packages/ui/src/components/chat/mui-chat-augmentation.d.ts`:

```ts
import type { ChatFilePart, ChatServiceBlock } from './chat-types'

declare module '@mui/x-chat/types' {
  interface ChatCustomMessagePartMap {
    file: ChatFilePart
    'service-status': ChatServiceBlock & { type: 'service-status' }
  }
}
```

- [ ] **Step 2.5: Implement the reusable components**

Key exports in `packages/ui/src/components/chat/index.ts`:

```ts
export * from './chat-types'
export { ChatThread } from './chat-thread'
export { ChatMessageList } from './chat-message-list'
export { ChatMessageContent } from './chat-message-content'
export { ChatComposer } from './chat-composer'
export { ChatEmptyState } from './chat-empty-state'
```

Core render logic in `chat-message-content.tsx`:

```tsx
'use client'

import { Box, Chip, Typography } from '../index'
import type { ChatFilePart, ChatServiceBlock, ChatTextPart } from './chat-types'

type Part = ChatTextPart | ChatFilePart | ({ type: 'service-status' } & ChatServiceBlock)

export function ChatMessageContent({ parts }: { parts: Part[] }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {parts.map((part) => {
        if (part.type === 'text') {
          return (
            <Typography key={`text-${part.text}`} sx={{ whiteSpace: 'pre-wrap' }}>
              {part.text}
            </Typography>
          )
        }
        if (part.type === 'file') {
          return (
            <Chip
              key={part.fileId}
              component="a"
              clickable
              label={part.name}
              href={part.downloadUrl}
              variant="outlined"
            />
          )
        }
        return <ChatServiceBlock key={part.id} block={part} />
      })}
    </Box>
  )
}
```

Core composer shell in `chat-composer.tsx`:

```tsx
'use client'

import {
  Box,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  AddIcon,
  ArrowUpwardIcon,
  Chip,
} from '../index'

type DraftAttachment = { localId: string; name: string }

type Props = {
  value: string
  attachments: DraftAttachment[]
  disabled?: boolean
  onValueChange: (value: string) => void
  onAttachClick?: () => void
  onRemoveAttachment?: (localId: string) => void
  onSend: (text: string) => void
}

export function ChatComposer(props: Props) {
  const canSend = props.value.trim().length > 0 && !props.disabled

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 3,
        p: 1.5,
        bgcolor: 'background.paper',
      }}
    >
      <Stack spacing={1}>
        {props.attachments.length > 0 ? (
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {props.attachments.map((file) => (
              <Chip
                key={file.localId}
                label={file.name}
                onDelete={() => props.onRemoveAttachment?.(file.localId)}
              />
            ))}
          </Stack>
        ) : null}
        <Stack direction="row" spacing={1} alignItems="flex-end">
          <Tooltip title="Добавить файл">
            <span>
              <IconButton size="small" onClick={props.onAttachClick} disabled={props.disabled}>
                <AddIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <TextField
            value={props.value}
            onChange={(event) => props.onValueChange(event.target.value)}
            multiline
            minRows={1}
            maxRows={12}
            fullWidth
            placeholder="Спросите что-нибудь..."
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                if (canSend) props.onSend(props.value.trim())
              }
            }}
          />
          <Tooltip title="Отправить">
            <span>
              <IconButton
                size="small"
                disabled={!canSend}
                onClick={() => props.onSend(props.value.trim())}
              >
                <ArrowUpwardIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Stack>
    </Box>
  )
}
```

- [ ] **Step 2.6: Export from the package barrel and add test config**

Append to `packages/ui/src/components/index.ts`:

```ts
export * from './chat'
```

Create `packages/ui/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
})
```

- [ ] **Step 2.7: Run package tests and type-check**

```bash
pnpm --filter @repo/ui test
pnpm --filter @repo/ui check-types
pnpm --filter @repo/ui lint
```

Expected: all green.

- [ ] **Step 2.8: Commit UI foundation**

```bash
git add packages/ui/package.json \
  packages/ui/src/components/index.ts \
  packages/ui/src/components/chat \
  packages/ui/test \
  packages/ui/vitest.config.ts \
  pnpm-lock.yaml
git commit -m "feat: add reusable workspace chat ui"
```

---

## Task 3: Normalize chat reads in `packages/trpc` and remove the MVP send mutation

Expose `parts`, `status`, and file metadata through `getChat`, and delete `sendMessage`.

**Files:**

- Modify: `packages/trpc/package.json`
- Modify: `packages/trpc/src/routers/chat.ts`
- Create: `packages/trpc/test/chat-router.test.ts`
- Create: `packages/trpc/vitest.config.ts`

- [ ] **Step 3.1: Add test runner to `@repo/trpc`**

Update `packages/trpc/package.json`:

```json
{
  "scripts": {
    "lint": "eslint . --max-warnings 0",
    "build": "tsc -p tsconfig.json",
    "check-types": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 3.2: Write failing router tests**

Create `packages/trpc/test/chat-router.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

describe('chatRouter getChat normalization', () => {
  it('emits text first and files after it', async () => {
    const dto = {
      parts: [
        { type: 'text', text: 'Привет' },
        {
          type: 'file',
          fileId: 'f1',
          name: 'brief.pdf',
          mimeType: 'application/pdf',
          fileSize: '10',
          downloadUrl: '/api/files/f1',
        },
      ],
      status: 'DONE',
    }

    expect(dto.parts[0]).toEqual({ type: 'text', text: 'Привет' })
    expect(dto.parts[1]).toMatchObject({ type: 'file', name: 'brief.pdf' })
  })
})
```

This test is intentionally minimal; the real implementation test should call the router with mocked Prisma data and assert the normalized output shape.

- [ ] **Step 3.3: Run tests to verify failure/setup gap**

```bash
pnpm --filter @repo/trpc test
```

Expected: fail until vitest config and router changes exist.

- [ ] **Step 3.4: Rewrite `chatRouter.getChat` output shape**

Key logic for `packages/trpc/src/routers/chat.ts`:

```ts
const messages = await ctx.prisma.chatMessage.findMany({
  where: { chatId: chat.id },
  orderBy: { createdAt: 'asc' },
  include: {
    files: {
      orderBy: { createdAt: 'asc' },
      include: { file: true },
    },
  },
})

return {
  chat,
  messages: messages.map((message) => ({
    id: message.id,
    role: message.role,
    status: message.status,
    errorMessage: message.errorMessage,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
    parts: [
      ...(message.content.trim().length > 0
        ? [{ type: 'text' as const, text: message.content }]
        : []),
      ...message.files.map(({ file }) => ({
        type: 'file' as const,
        fileId: file.id,
        name: file.name,
        mimeType: file.mimeType,
        fileSize: file.fileSize.toString(),
        downloadUrl: `/api/files/${file.id}`,
      })),
    ],
  })),
}
```

- [ ] **Step 3.5: Delete the old `sendMessage` mutation**

Remove this entire block from `chatRouter`:

```ts
sendMessage: protectedProcedure
  .input(
    z.object({
      chatId: z.string().uuid(),
      content: z.string().min(1).max(4000),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    // remove entire MVP echo flow
  }),
```

- [ ] **Step 3.6: Add package test config and run checks**

Create `packages/trpc/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
```

Run:

```bash
pnpm --filter @repo/trpc test
pnpm --filter @repo/trpc check-types
pnpm --filter @repo/trpc lint
```

Expected: green, and any import sites referencing `trpc.chat.sendMessage` now fail and will be fixed in Task 6.

- [ ] **Step 3.7: Commit router normalization**

```bash
git add packages/trpc/package.json \
  packages/trpc/src/routers/chat.ts \
  packages/trpc/test/chat-router.test.ts \
  packages/trpc/vitest.config.ts \
  pnpm-lock.yaml
git commit -m "feat: normalize chat messages for ui"
```

---

## Task 4: Upgrade `apps/agents` to emit structured status events

Teach the agents stream to emit `status` frames for tool and confirmation updates.

**Files:**

- Modify: `apps/agents/agents/apps/chat/schemas.py`
- Modify: `apps/agents/agents/apps/chat/use_cases/generate_stream.py`
- Create: `apps/agents/tests/apps/chat/test_generate_stream.py`

- [ ] **Step 4.1: Write failing pytest coverage**

Create `apps/agents/tests/apps/chat/test_generate_stream.py`:

```py
from agents.apps.chat.schemas import ServerEvent


def test_status_event_shape():
    event = ServerEvent.status(
        id="tool-1",
        kind="tool",
        state="running",
        title="list_tools",
        detail="Calling MCP tool",
    )

    assert event.type == "status"
    assert event.id == "tool-1"
    assert event.kind == "tool"
    assert event.state == "running"
```

- [ ] **Step 4.2: Run the test to confirm failure**

```bash
pnpm --filter agents test -- tests/apps/chat/test_generate_stream.py
```

Expected: fail because `ServerEvent.status()` and the extra fields do not exist.

- [ ] **Step 4.3: Extend `ServerEvent`**

Modify `apps/agents/agents/apps/chat/schemas.py`:

```py
class ServerEvent(RequestResponseSchema):
    type: Literal["token", "status", "done", "error"]
    text: str | None = None
    id: str | None = None
    kind: Literal["tool", "confirmation"] | None = None
    state: Literal["pending", "running", "done", "error", "required"] | None = None
    title: str | None = None
    detail: str | None = None
    code: str | None = None
    message: str | None = None

    @classmethod
    def status(
        cls,
        *,
        id: str,
        kind: Literal["tool", "confirmation"],
        state: Literal["pending", "running", "done", "error", "required"],
        title: str,
        detail: str | None = None,
    ) -> "ServerEvent":
        return cls(type="status", id=id, kind=kind, state=state, title=title, detail=detail)
```

- [ ] **Step 4.4: Emit structured updates in the use case**

Replace the token-flattening update branch in `generate_stream.py` with status events:

```py
elif chunk["type"] == "updates":
    for source, update in chunk["data"].items():
        message = update["messages"][-1]
        if source == "llm" and isinstance(message, AIMessage) and message.tool_calls:
            for index, call in enumerate(message.tool_calls):
                yield ServerEvent.status(
                    id=call.get("id") or f"tool-{index}",
                    kind="tool",
                    state="running",
                    title=call.get("name", "tool"),
                    detail="Executing tool call",
                )
        elif source == "tools" and isinstance(message, ToolMessage):
            yield ServerEvent.status(
                id=message.tool_call_id,
                kind="tool",
                state="done",
                title="tool-result",
                detail=self.extract_token_text(message.content_blocks) or str(message.content),
            )
```

If the graph later emits explicit approval/confirmation checkpoints, map them to `kind="confirmation"` and `state="required"`.

- [ ] **Step 4.5: Run tests**

```bash
pnpm --filter agents test -- tests/apps/chat/test_generate_stream.py
pnpm --filter agents check-types
pnpm --filter agents lint
```

Expected: green.

- [ ] **Step 4.6: Commit agent stream contract**

```bash
git add apps/agents/agents/apps/chat/schemas.py \
  apps/agents/agents/apps/chat/use_cases/generate_stream.py \
  apps/agents/tests/apps/chat/test_generate_stream.py
git commit -m "feat: add structured chat status events"
```

---

## Task 5: Implement web-side start/resume SSE orchestration

Replace the current one-off proxy with a registry-backed orchestration layer that persists partial assistant content.

**Files:**

- Modify: `apps/web/package.json`
- Create: `apps/web/src/lib/chat/types.ts`
- Create: `apps/web/src/lib/chat/active-stream-registry.ts`
- Create: `apps/web/src/lib/chat/agents-payload.ts`
- Create: `apps/web/src/lib/chat/sse.ts`
- Modify: `apps/web/src/app/api/agents/generate/route.ts`
- Create: `apps/web/src/app/api/agents/streams/[assistantMessageId]/route.ts`
- Create: `apps/web/test/active-stream-registry.test.ts`
- Create: `apps/web/test/api-agents-generate.test.ts`
- Create: `apps/web/vitest.config.ts`

- [ ] **Step 5.1: Add web test tooling**

Update `apps/web/package.json`:

```json
{
  "scripts": {
    "dev": "next dev --turbo --port 3000",
    "build": "next build",
    "start": "next start",
    "lint": "eslint --max-warnings 0",
    "check-types": "next typegen && tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "jsdom": "^26.1.0",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 5.2: Write failing registry test first**

Create `apps/web/test/active-stream-registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { createActiveStreamRegistry } from '../src/lib/chat/active-stream-registry'

describe('active stream registry', () => {
  it('broadcasts deltas to multiple subscribers', async () => {
    const registry = createActiveStreamRegistry()
    const entry = registry.create('assistant-1')

    const seen: string[] = []
    entry.subscribe((event) => {
      if (event.type === 'message.delta') seen.push(event.text)
    })

    entry.publishDelta('При')
    entry.publishDelta('вет')

    expect(seen).toEqual(['При', 'вет'])
  })
})
```

- [ ] **Step 5.3: Run the test to confirm failure**

```bash
pnpm --filter web test -- active-stream-registry
```

Expected: fail because registry files do not exist.

- [ ] **Step 5.4: Implement shared web-layer types and registry**

Create `apps/web/src/lib/chat/types.ts`:

```ts
export type ServiceBlock = {
  id: string
  kind: 'tool' | 'confirmation'
  state: 'pending' | 'running' | 'done' | 'error' | 'required'
  title: string
  detail?: string
}

export type WebChatSseEvent =
  | { type: 'message.created'; assistantMessageId: string; userMessageId: string }
  | { type: 'message.delta'; assistantMessageId: string; text: string }
  | { type: 'message.service'; assistantMessageId: string; blocks: ServiceBlock[] }
  | {
      type: 'message.status'
      assistantMessageId: string
      status: 'STREAMING' | 'DONE' | 'ERROR'
      errorMessage?: string
    }
  | { type: 'message.done'; assistantMessageId: string }
```

Create `apps/web/src/lib/chat/active-stream-registry.ts`:

```ts
import type { WebChatSseEvent, ServiceBlock } from './types'

type Subscriber = (event: WebChatSseEvent) => void

type Entry = {
  assistantMessageId: string
  content: string
  blocks: ServiceBlock[]
  subscribers: Set<Subscriber>
  subscribe: (fn: Subscriber) => () => void
  publishDelta: (text: string) => void
  publishBlocks: (blocks: ServiceBlock[]) => void
  publishStatus: (status: 'STREAMING' | 'DONE' | 'ERROR', errorMessage?: string) => void
}

export function createActiveStreamRegistry() {
  const entries = new Map<string, Entry>()

  function create(assistantMessageId: string): Entry {
    const entry: Entry = {
      assistantMessageId,
      content: '',
      blocks: [],
      subscribers: new Set(),
      subscribe(fn) {
        entry.subscribers.add(fn)
        return () => entry.subscribers.delete(fn)
      },
      publishDelta(text) {
        entry.content += text
        for (const subscriber of entry.subscribers) {
          subscriber({ type: 'message.delta', assistantMessageId, text })
        }
      },
      publishBlocks(blocks) {
        entry.blocks = blocks
        for (const subscriber of entry.subscribers) {
          subscriber({ type: 'message.service', assistantMessageId, blocks })
        }
      },
      publishStatus(status, errorMessage) {
        for (const subscriber of entry.subscribers) {
          subscriber({ type: 'message.status', assistantMessageId, status, errorMessage })
        }
      },
    }
    entries.set(assistantMessageId, entry)
    return entry
  }

  return {
    entries,
    create,
    get: (id: string) => entries.get(id),
    delete: (id: string) => entries.delete(id),
  }
}
```

- [ ] **Step 5.5: Replace the start route with transaction + registry flow**

Key structure for `apps/web/src/app/api/agents/generate/route.ts`:

```ts
type StartChatGenerationBody = {
  chatId: string
  text: string
  fileIds: string[]
}

const { userMessage, assistantMessage, chat, settings } = await prisma.$transaction(async (tx) => {
  const userMessage = await tx.chatMessage.create({
    data: {
      chatId: chat.id,
      role: 'USER',
      status: 'DONE',
      content: body.text.trim(),
    },
  })

  if (body.fileIds.length > 0) {
    await tx.chatMessageFile.createMany({
      data: body.fileIds.map((fileId) => ({ messageId: userMessage.id, fileId })),
      skipDuplicates: true,
    })
  }

  const assistantMessage = await tx.chatMessage.create({
    data: {
      chatId: chat.id,
      role: 'ASSISTANT',
      status: 'STREAMING',
      content: '',
      errorMessage: null,
    },
  })

  return { userMessage, assistantMessage, chat, settings }
})
```

Then create/start the registry entry, call `fetch(`${agentsUrl}/chat/generate`, ...)`, normalize upstream events, flush `content` back into Prisma on an interval, and broadcast `message.delta` / `message.service` / `message.status`.

- [ ] **Step 5.6: Add the resume route**

Create `apps/web/src/app/api/agents/streams/[assistantMessageId]/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server'

import { activeStreamRegistry } from '@/lib/chat/active-stream-registry'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ assistantMessageId: string }> },
) {
  const { assistantMessageId } = await params
  const entry = activeStreamRegistry.get(assistantMessageId)

  if (!entry) {
    return NextResponse.json({ error: 'Stream not active' }, { status: 404 })
  }

  return new Response(
    new ReadableStream({
      start(controller) {
        const unsubscribe = entry.subscribe((event) => {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
        })
        controller.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify({ type: 'message.status', assistantMessageId, status: 'STREAMING' })}\n\n`,
          ),
        )
        return () => unsubscribe()
      },
    }),
    {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    },
  )
}
```

- [ ] **Step 5.7: Run server-side tests and package checks**

```bash
pnpm --filter web test
pnpm --filter web check-types
pnpm --filter web lint
```

Expected: green.

- [ ] **Step 5.8: Commit web orchestration**

```bash
git add apps/web/package.json \
  apps/web/src/lib/chat \
  apps/web/src/app/api/agents/generate/route.ts \
  apps/web/src/app/api/agents/streams/[assistantMessageId]/route.ts \
  apps/web/test \
  apps/web/vitest.config.ts \
  pnpm-lock.yaml
git commit -m "feat: add web chat streaming orchestration"
```

---

## Task 6: Replace the page-level client with the new chat UI

Swap out the old `SearchChat*` components and connect the page to tRPC history + upload + send + reload-resume.

**Files:**

- Create: `apps/web/src/components/workspace/chat/workspace-chat-client.tsx`
- Create: `apps/web/src/components/workspace/chat/use-chat-stream.ts`
- Create: `apps/web/src/components/workspace/chat/use-draft-attachments.ts`
- Create: `apps/web/src/components/workspace/chat/chat-message-mappers.ts`
- Modify: `apps/web/src/app/(protected)/workspaces/[workspaceId]/chats/[chatId]/page.tsx`
- Delete or stop importing: `apps/web/src/components/workspace/search/search-chat-view.tsx`
- Delete or stop importing: `apps/web/src/components/workspace/search/search-chat-input.tsx`
- Create: `apps/web/test/workspace-chat-client.test.tsx`

- [ ] **Step 6.1: Write failing client tests**

Create `apps/web/test/workspace-chat-client.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'

describe('workspace chat client', () => {
  it('treats the last STREAMING assistant message as resumable', () => {
    const messages = [{ id: 'a1', role: 'ASSISTANT', status: 'STREAMING' }]
    expect(messages.at(-1)?.status).toBe('STREAMING')
  })
})
```

Then evolve the real test to cover:

- DTO → UI part mapping
- calling `/api/agents/generate` with `fileIds`
- resume call when the last message is `STREAMING`

- [ ] **Step 6.2: Run the test to confirm failure/setup gap**

```bash
pnpm --filter web test -- workspace-chat-client
```

Expected: fail until the client module exists.

- [ ] **Step 6.3: Create the draft-attachment hook**

`apps/web/src/components/workspace/chat/use-draft-attachments.ts`:

```ts
import { useState } from 'react'

type DraftAttachment = {
  localId: string
  fileId: string
  name: string
  mimeType: string
  fileSize: string
}

export function useDraftAttachments(workspaceId: string) {
  const [attachments, setAttachments] = useState<DraftAttachment[]>([])

  async function upload(file: File) {
    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch(`/api/files/upload?kind=attachment&workspaceId=${workspaceId}`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    })
    const data = await response.json()
    setAttachments((current) => [
      ...current,
      {
        localId: crypto.randomUUID(),
        fileId: data.file.id,
        name: data.file.name,
        mimeType: data.file.mimeType,
        fileSize: data.file.fileSize,
      },
    ])
  }

  return {
    attachments,
    upload,
    remove: (localId: string) =>
      setAttachments((current) => current.filter((file) => file.localId !== localId)),
    clear: () => setAttachments([]),
  }
}
```

- [ ] **Step 6.4: Build the client orchestrator**

Core structure for `workspace-chat-client.tsx`:

```tsx
'use client'

import { useEffect, useState, startTransition } from 'react'

import { ChatThread } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

export function WorkspaceChatClient({
  chatId,
  workspaceId,
}: {
  chatId: string
  workspaceId: string
}) {
  const query = trpc.chat.getChat.useQuery({ chatId })
  const attachments = useDraftAttachments(workspaceId)
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<any[]>([])

  useEffect(() => {
    if (!query.data) return
    startTransition(() => {
      setMessages(query.data.messages)
    })
  }, [query.data])

  useEffect(() => {
    const last = query.data?.messages.at(-1)
    if (!last || last.role !== 'ASSISTANT' || last.status !== 'STREAMING') return
    const source = new EventSource(`/api/agents/streams/${last.id}`)
    return () => source.close()
  }, [query.data?.messages])

  async function send(text: string) {
    const response = await fetch('/api/agents/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId,
        text,
        fileIds: attachments.attachments.map((file) => file.fileId),
      }),
    })
    // parse SSE and merge into local message state
  }

  return (
    <ChatThread
      messages={messages}
      composerValue={draft}
      onComposerValueChange={setDraft}
      onSend={send}
      onAttach={attachments.upload}
      onRemoveAttachment={attachments.remove}
      draftAttachments={attachments.attachments}
    />
  )
}
```

- [ ] **Step 6.5: Replace the old page import**

Update `apps/web/src/app/(protected)/workspaces/[workspaceId]/chats/[chatId]/page.tsx`:

```tsx
import { WorkspaceChatClient } from '@/components/workspace/chat/workspace-chat-client'

export default async function SearchChatPage({ params }: Props) {
  const { workspaceId, chatId } = await params
  const trpc = await getServerTRPC()
  try {
    await trpc.chat.getChat({ chatId })
  } catch {
    notFound()
  }
  return <WorkspaceChatClient chatId={chatId} workspaceId={workspaceId} />
}
```

Delete the legacy `SearchChatView` / `SearchChatInput` files if they are unused after the import swap.

- [ ] **Step 6.6: Run client tests and app checks**

```bash
pnpm --filter web test
pnpm --filter web check-types
pnpm --filter web lint
pnpm --filter web build
```

Expected: green, and there are no remaining imports of `trpc.chat.sendMessage`.

- [ ] **Step 6.7: Commit page integration**

```bash
git add apps/web/src/components/workspace/chat \
  apps/web/src/app/(protected)/workspaces/[workspaceId]/chats/[chatId]/page.tsx \
  apps/web/test \
  apps/web/package.json \
  pnpm-lock.yaml
git commit -m "feat: replace workspace chat page with streaming ui"
```

---

## Task 7: Final verification and contract cleanup

Run focused verification across every touched layer and update the HTTP sample if it drifted.

**Files:**

- Modify: `apps/agents/requests.http` (only if the checked-in sample differs from the implemented payload)

- [ ] **Step 7.1: Update the sample request if needed**

The final sample in `apps/agents/requests.http` should match the implemented agents contract:

```http
POST http://localhost:8080/chat/generate HTTP/1.1
content-type: application/json
x-user-id: 123e4567-e89b-12d3-a456-426614174000
x-workspace-id: 123e4567-e89b-12d3-a456-426614174001

{
  "threadId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "model": {
    "provider": "gigachat",
    "name": "GigaChat-2",
    "connection": {
      "clientId": "019da3de-19e1-7f92-a0e1-5b90595c8e6c",
      "clientSecret": "e0762394-8b7c-48d4-84ea-dd3e4e57420b",
      "scope": "GIGACHAT_API_PERS"
    },
    "settings": {
      "temperature": 0,
      "topP": 0
    }
  },
  "systemPrompt": "Ты профессиональный помощник, который помогает пользователю с его запросами. Ты всегда отвечаешь на русском языке.",
  "instruction": {
    "format": "markdown",
    "language": "ru",
    "citationsRequired": true
  },
  "mcp": {
    "servers": [{
      "name": "AnyNote MCP Server",
      "url": "http://localhost:8090/api/mcp",
      "headers": {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "X-User-Id": "123e4567-e89b-12d3-a456-426614174000",
        "x-Workspace-Id": "123e4567-e89b-12d3-a456-426614174001"
      },
      "retries": 3,
      "verify": false
    }]
  },
  "query": "Какие возможности у AnyNote MCP Server?"
}
```

- [ ] **Step 7.2: Run focused package tests**

```bash
pnpm --filter @repo/ui test
pnpm --filter @repo/trpc test
pnpm --filter web test
pnpm --filter agents test
```

Expected: all green.

- [ ] **Step 7.3: Run repo-level gates**

```bash
pnpm check-types
pnpm lint
pnpm build
pnpm test
```

Expected: all green.

- [ ] **Step 7.4: Commit verification or sample cleanup if needed**

```bash
git add apps/agents/requests.http
git commit -m "chore: align chat request samples"
```

Skip this commit if `requests.http` did not change.

---

## Self-Review Checklist

- Every user-approved decision is covered:
  - `@repo/ui`, not `@repo/chat`
  - `parts = text(content) + files`
  - draft files linked only at send time
  - send blocked when text is empty
  - tool/confirmation UI lives inside assistant message
  - `ChatMessage.status`, `updatedAt`, `errorMessage`
  - legacy `trpc.chat.sendMessage` removed
- Reload continuation is implemented through `ChatMessage.status` plus
  `apps/web` active-stream registry.
- Agents contract uses `/chat/generate`, not the outdated `/api/v1/generate`.
- `x-user-id` always comes from the active session user, not `chat.createdById`.
