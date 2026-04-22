# Workspace Chat Streaming Design

**Date:** 2026-04-22  
**Author:** brainstormed with Codex  
**Status:** Approved in conversation → pending written-spec review

## Context

The current chat page at
`/workspaces/{workspaceId}/chats/{chatId}` still uses
`SearchChatView` + `SearchChatInput` and the legacy
`trpc.chat.sendMessage` MVP path. That path stores a user message and
an echoed assistant response, but it does not support:

- `@mui/x-chat`-based UI composition
- file draft attachments in the composer
- `ChatMessage.parts` rendering
- structured streaming state
- recovery after page reload during a live response
- tool-call / confirmation status blocks inside the active assistant
  message

At the same time, the repo already contains most of the necessary
primitives:

- `File`, `Chat`, `ChatMessage`, and `ChatMessageFile` tables
- `WorkspaceAiSettings`, `AiModel`, and `AiProvider`
- `/api/files/upload` in `apps/web`
- `/chat/generate` in `apps/agents`
- a server-side `apps/web` proxy route at
  `src/app/api/agents/generate/route.ts`

This design replaces the MVP flow with a persistent, streaming-aware
chat implementation while keeping all reusable chat UI code inside
`@repo/ui`.

## Approved Product Decisions

These decisions were explicitly confirmed during brainstorming and are
part of the scope:

1. Chat UI stays inside `packages/ui`, exported through `@repo/ui`.
2. All new chat component source lives under
   `packages/ui/src/components`.
3. `ChatMessage.parts` is assembled on read:
   - first `text` from `ChatMessage.content`
   - then `file` parts from `ChatMessageFile -> File`
4. Draft attachments upload immediately as `File` rows in the
   workspace, but are linked to `ChatMessage` only when the user
   presses Send.
5. Send is blocked when the text area is empty, even if attachments are
   present.
6. Tool-call / confirmation UI is rendered inside the current
   assistant message as service-status blocks, not as separate timeline
   rows.
7. `ChatMessage` must be extended with `status`, `updatedAt`, and
   `errorMessage`.
8. The old `trpc.chat.sendMessage` MVP path will be removed, not kept
   as fallback.

## Goals

1. Replace the old chat page with a modern `@mui/x-chat`-based thread
   that matches the approved UI:
   - breadcrumbs-only header
   - centered thread content
   - embedded attach/send icons inside the composer surface
   - no explicit `Assistant` label in assistant bubbles
2. Support plain-text composer input that auto-grows upward to 12 rows
   maximum.
3. Support file upload, local draft attachment removal, and
   `ChatMessageFile` persistence on send.
4. Persist user and assistant messages in the database so page reloads
   do not lose history.
5. Stream the assistant response from `apps/agents` through `apps/web`
   to the browser.
6. Continue streaming after a page reload while the same assistant
   response is still in progress.
7. Render tool/confirmation progress inside the active assistant
   message as transient service blocks.

## Non-Goals

- No separate `@repo/chat` package.
- No model picker or “More” actions in the chat header.
- No attachment-only sends.
- No persistence of service-status blocks to the database.
- No multi-instance or cross-process resume guarantee. Reload recovery
  is designed for a single running `apps/web` Node process, which
  matches the local/dev environment and the current app topology.
- No new database table for stream sessions. Streaming state is tracked
  through `ChatMessage.status` plus an in-memory registry in
  `apps/web`.
- No automatic cleanup job for uploaded-but-unlinked draft files.

## Architecture Overview

The implementation has four layers:

1. **Persistent domain layer**
   Prisma models `Chat`, `ChatMessage`, `ChatMessageFile`, and `File`
   remain the source of truth for saved conversation history.
2. **Reusable UI layer**
   `packages/ui` exposes reusable chat components built on top of
   `@mui/x-chat`, but does not own transport or database persistence.
3. **Web orchestration layer**
   `apps/web` owns:
   - read-model normalization for `ChatMessage.parts`
   - attachment upload integration
   - start/resume SSE endpoints
   - active-stream registry
   - persistence of streaming assistant content
4. **Agents execution layer**
   `apps/agents` continues to own generation and tool execution, but
   its SSE event shape must be upgraded to emit structured service
   status events instead of flattening all updates into plain text.

## Detailed Design

### 1. Prisma And Domain Model Changes

`ChatMessage` will be extended so a live assistant response has a
durable status and can be recovered after reload.

#### Schema changes

Add a new enum:

```prisma
enum ChatMessageStatus {
  STREAMING
  DONE
  ERROR
}
```

Update `ChatMessage`:

```prisma
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

#### Migration behavior

- Existing rows are backfilled to `status = DONE`.
- Existing rows get `updatedAt = createdAt` at migration time.
- `errorMessage` remains `NULL` for all existing rows.

#### Message semantics

- `USER` messages are always created as `DONE`.
- Assistant messages are created as `STREAMING` before the upstream
  request begins.
- Assistant messages transition to:
  - `DONE` on successful completion
  - `ERROR` if upstream startup fails, the stream ends in error, or the
    web proxy loses the stream irrecoverably

### 2. Reusable UI In `@repo/ui`

All reusable chat UI code stays under
`packages/ui/src/components/chat/` and is re-exported from
`packages/ui/src/components/index.ts`.

Recommended file layout:

```text
packages/ui/src/components/chat/
  chat-thread.tsx
  chat-message-list.tsx
  chat-message-content.tsx
  chat-composer.tsx
  chat-file-chip.tsx
  chat-service-block.tsx
  chat-empty-state.tsx
  chat-types.ts
  mui-chat-augmentation.d.ts
  index.ts
```

#### `@mui/x-chat` composition strategy

Use low-level material components from `@mui/x-chat`, not the turnkey
`ChatBox`, because the page header must remain the existing
breadcrumbs-only shell.

The primary building blocks are:

- `ChatProvider`
- `ChatMessageList`
- `ChatComposer`
- `ChatComposerTextArea`
- `ChatComposerAttachButton`
- `ChatComposerSendButton`

This lets `apps/web` keep the existing page header outside the chat
provider while `packages/ui` controls the message list and composer.

#### Composer behavior

The composer follows the approved interaction model:

- plain text only
- auto-resize up to 12 rows
- grows upward before inner scroll
- `Enter` sends
- `Shift+Enter` inserts newline
- IME-safe submit
- attach and send actions are icon buttons rendered inside the composer
  surface
- draft attachments render as removable chips inside the composer
  surface above the current draft text

`@mui/x-chat` supports attachments and IME-safe submission out of the
box, but its underlying composer submit path allows sends when either
text or attachments are present. AnyNote must override that rule so the
send action and submit handler are both blocked when the text is empty.

#### Message parts

The persisted message model is intentionally narrow:

- `text` part for the saved `content`
- `file` parts for linked files

`@mui/x-chat` type augmentation will register a custom `file` part so
message rendering remains typed.

In addition, the UI runtime will register a transient custom part type
for service-status blocks:

- `service-status`

This part type is **not** persisted to the database. It only exists in
the live runtime state while an assistant message is still streaming.

#### Rendering rules

- User messages render as a single `text` part.
- Assistant messages render:
  - persisted `text`
  - zero or more transient `service-status` parts during the active
    stream
  - zero or more persisted `file` parts after `ChatMessageFile`
    normalization
- No explicit “Assistant” label is shown in the bubble.
- No model button or extra chat actions are shown in the header.

### 3. Read Model And tRPC Changes

The read path must return messages already normalized for the chat UI.

#### `trpc.chat.getChat`

`getChat` will continue to enforce workspace access, but its payload
changes:

- include `files` through `ChatMessageFile -> File`
- map Prisma records into a chat-specific DTO
- expose `status`, `errorMessage`, `createdAt`, and `updatedAt`
- expose `parts`

Target DTO shape:

```ts
type ChatFilePart = {
  type: "file"
  fileId: string
  name: string
  mimeType: string
  fileSize: string
  downloadUrl: string
}

type ChatTextPart = {
  type: "text"
  text: string
}

type ChatMessageDto = {
  id: string
  role: "USER" | "ASSISTANT"
  status: "STREAMING" | "DONE" | "ERROR"
  errorMessage: string | null
  createdAt: string
  updatedAt: string
  parts: Array<ChatTextPart | ChatFilePart>
}
```

Normalization rule:

- if `content.trim().length > 0`, emit one `text` part first
- then emit one `file` part per linked file, ordered by
  `ChatMessageFile.createdAt ASC`

#### `trpc.chat.sendMessage`

Delete the mutation entirely. The chat page must no longer rely on the
old echo-MVP path.

#### Other chat router methods

`listChats`, `renameChat`, and `deleteChat` remain. They continue to
serve the sidebar and page shell.

### 4. Draft Attachment Lifecycle

Attachments have two phases:

1. **Draft file phase**
   The file is uploaded immediately to `/api/files/upload` as a plain
   workspace `File`.
2. **Message link phase**
   The file is linked to a specific `ChatMessage` only when Send is
   pressed.

#### Upload flow

From the client composer:

1. User picks a file with the embedded attach icon.
2. The client uploads it to:
   `/api/files/upload?kind=attachment&workspaceId={workspaceId}`.
3. The server creates or reuses a `File` row.
4. The client stores a draft attachment object:
   - local UI id
   - `fileId`
   - display name
   - size
   - mime type
   - upload status

#### Remove flow

- Removing a draft attachment only removes it from the current composer
  state.
- It does **not** delete the `File` row.
- Unlinked uploaded files remain valid workspace `File` rows. This
  design does not introduce automatic cleanup or delete-on-remove
  behavior.

### 5. Web Streaming Orchestration

`apps/web` becomes the orchestrator for persistence and reload-safe
stream fan-out.

#### New server-side responsibilities

The chat proxy route must:

1. validate the user’s access to the chat
2. load AI settings from the chat’s workspace
3. save the user message and `ChatMessageFile` links
4. create the assistant placeholder row with `status = STREAMING`
5. start exactly one upstream request to `apps/agents`
6. persist assistant text while the stream is in progress
7. fan out live deltas to any connected browser clients
8. allow a fresh browser connection after page reload to re-subscribe
   to the same in-progress assistant message

#### Required routes

1. `POST /api/agents/generate`
   Starts a new assistant response and returns SSE for the caller.
2. `GET /api/agents/streams/{assistantMessageId}`
   Re-subscribes to an already running assistant stream after reload.

#### `POST /api/agents/generate` request body

The browser sends a web-facing payload, not the raw agents payload:

```ts
type StartChatGenerationBody = {
  chatId: string
  text: string
  fileIds: string[]
}
```

Validation:

- `chatId` must exist and be visible to the current user
- `text.trim()` must be non-empty
- every `fileId` must belong to the current user or workspace and must
  be visible from the current workspace

#### Start flow

In one transaction:

1. create the `USER` message with `status = DONE`
2. create `ChatMessageFile` rows for the supplied files
3. create the `ASSISTANT` message with:
   - `status = STREAMING`
   - `content = ""`
   - `errorMessage = NULL`
4. update `Chat.updatedAt`
5. rename the chat from `"Новый чат"` if it still has the default title

After the transaction commits:

1. start the active stream job in the registry
2. subscribe the current request to that job
3. return SSE to the browser

### 6. Active Stream Registry

Reload-safe continuation requires a process-local registry in
`apps/web`.

Recommended module:

```text
apps/web/src/lib/chat/active-stream-registry.ts
```

#### Registry responsibilities

Each active entry is keyed by `assistantMessageId` and stores:

- `assistantMessageId`
- `chatId`
- current accumulated assistant text
- current service-status snapshot
- `status`
- `errorMessage`
- subscriber set
- upstream task promise
- timestamps for cleanup

#### Registry behavior

- Starting a stream creates exactly one upstream consumer for that
  assistant message.
- Subscribers receive broadcast updates over SSE.
- If the original browser disconnects, the upstream consumer continues
  running.
- A later `GET /api/agents/streams/{assistantMessageId}` call joins the
  same registry entry and starts receiving future updates immediately.
- On `DONE` or `ERROR`, the registry finalizes persistence and evicts
  the entry after a short TTL.

#### Persistence cadence

The registry persists `ChatMessage.content` during streaming using a
debounced flush, for example every 150–300 ms plus a mandatory final
flush at completion.

That gives two guarantees:

- page reload sees recent assistant content in the database
- the database is not written on every single token

### 7. Outbound Request From `apps/web` To `apps/agents`

The actual upstream call must target the current route in
`apps/agents`:

```http
POST http://localhost:8080/chat/generate
```

The user-provided text referenced `/api/generate`, but the actual
current router in the codebase is `/chat/generate`, and the written
spec follows the real route.

#### Header mapping

Use the authenticated session user and the chat’s workspace:

- `x-user-id = session.user.id`
- `x-workspace-id = chat.workspaceId`

This is intentional. The schema does not have `Chat.userId`; it has
`createdById`. Using `createdById` would make shared chats execute MCP
requests as the chat creator instead of the current actor, which is not
correct for workspace membership access.

#### Payload mapping

`apps/web` builds the raw agents payload like this:

```json
{
  "threadId": "<chat.id>",
  "model": {
    "provider": "<workspaceDefaultModel.provider.slug>",
    "name": "<workspaceDefaultModel.slug>",
    "connection": "<workspaceDefaultModel.provider.connection>",
    "settings": {
      "temperature": "<workspaceAiSettings.temperature>",
      "topP": "<workspaceAiSettings.topP>"
    }
  },
  "systemPrompt": "<workspaceAiSettings.systemPrompt or empty string>",
  "mcp": {
    "servers": [{
      "name": "AnyNote MCP Server",
      "url": "http://localhost:8090/api/mcp",
      "headers": {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "X-User-Id": "<session.user.id>",
        "x-Workspace-Id": "<chat.workspaceId>"
      },
      "retries": 3,
      "verify": false
    }]
  },
  "instruction": {
    "format": "markdown",
    "language": "ru",
    "citationsRequired": true
  },
  "query": "<user text>"
}
```

#### Conversation history

This feature does **not** send the full message history in the payload.
The request shape follows the current `apps/agents/requests.http`
example and the user-approved payload. Conversation history remains
stored in AnyNote for UI reload and auditing, but the initial
integration sends only the current `query` plus `threadId`.

### 8. Structured SSE Contract

The current `apps/agents` stream emits `token`, `done`, and `error`.
That is not enough for service-status rendering. The contract must be
extended.

#### Agents-side event model

`apps/agents` should emit these event shapes:

```ts
type AgentsStreamEvent =
  | { type: "token"; text: string }
  | {
      type: "status"
      id: string
      kind: "tool" | "confirmation"
      state: "pending" | "running" | "done" | "error" | "required"
      title: string
      detail?: string
    }
  | { type: "done" }
  | { type: "error"; code: string; message: string }
```

#### Web-to-browser event model

The browser should not parse raw agents events directly. `apps/web`
normalizes them into a UI-facing SSE contract:

```ts
type WebChatSseEvent =
  | {
      type: "message.created"
      assistantMessageId: string
      userMessageId: string
    }
  | {
      type: "message.delta"
      assistantMessageId: string
      text: string
    }
  | {
      type: "message.service"
      assistantMessageId: string
      blocks: Array<{
        id: string
        kind: "tool" | "confirmation"
        state: "pending" | "running" | "done" | "error" | "required"
        title: string
        detail?: string
      }>
    }
  | {
      type: "message.status"
      assistantMessageId: string
      status: "STREAMING" | "DONE" | "ERROR"
      errorMessage?: string
    }
  | {
      type: "message.done"
      assistantMessageId: string
    }
```

The browser uses:

- `message.delta` to append text to the active assistant message
- `message.service` to replace the current transient service blocks
- `message.status` and `message.done` to finalize local UI state

### 9. Reload And Resume Semantics

Reload recovery works in two stages.

#### Stage 1: database bootstrap

On page load:

1. `trpc.chat.getChat` loads saved history.
2. The UI renders all persisted messages and files.
3. If the latest assistant message has `status = STREAMING`, the client
   treats it as resumable.

#### Stage 2: live resume

If a resumable message exists:

1. the client opens
   `GET /api/agents/streams/{assistantMessageId}`
2. `apps/web` looks up the registry entry
3. if the stream is still active, the server resumes live delivery of
   future deltas and service blocks
4. if the registry no longer has the stream, the server returns a clean
   terminal event and the client keeps the persisted database state

Result:

- reload never loses persisted history
- reload can continue a still-active assistant response
- service-status blocks after reload are only available if the active
  stream still exists in the registry

### 10. Error Handling

#### Before upstream start

If message persistence fails, the request fails immediately and no
upstream call is made.

If the user message is saved but upstream startup fails, the assistant
placeholder row is updated to:

- `status = ERROR`
- `errorMessage = <short user-safe message>`
- `content = ""`

#### During streaming

If the upstream stream fails after text has already been received:

- keep the accumulated `content`
- set `status = ERROR`
- set `errorMessage`
- broadcast `message.status` with `ERROR`

#### Client rendering

- `DONE` messages render normally
- `STREAMING` messages render the live cursor and transient service
  blocks
- `ERROR` messages render saved text, if any, plus an inline error
  state

### 11. Page Integration

The current page shell stays in place:

- `apps/web/src/app/(protected)/workspaces/[workspaceId]/chats/[chatId]/page.tsx`
  remains the server entry and access check

But the old implementation is replaced:

- `SearchChatView` and `SearchChatInput` are removed from the active
  path
- a new client chat container in `apps/web` owns:
  - normalized query data
  - upload state
  - send logic
  - SSE subscription and resume logic
  - bridging between `@mui/x-chat` runtime state and persisted
    `ChatMessageDto`

### 12. Testing Scope

#### UI component tests in `packages/ui`

Cover:

- text area auto-growth and max-row cap
- send disabled when text is empty
- attach/remove draft files
- rendering of `text` and `file` parts
- rendering of transient `service-status` blocks

#### Web-layer tests

Cover:

- `getChat` normalization to `parts`
- validation of `fileIds` ownership/workspace access
- transactional creation of:
  - user message
  - `ChatMessageFile` rows
  - assistant placeholder message
- payload construction for `apps/agents`
- removal of legacy `trpc.chat.sendMessage`

#### Streaming and recovery tests

Cover:

- assistant text flushes into `ChatMessage.content` while status is
  `STREAMING`
- registry subscriber receives deltas and service blocks
- reload flow rehydrates saved history and reconnects to a running
  stream
- `DONE` and `ERROR` terminal transitions persist correctly

## Risks And Trade-Offs

1. `@mui/x-chat` is still an alpha surface, so business state must stay
   outside it. AnyNote should treat it as a rendering/runtime toolkit,
   not as the source of truth.
2. Resume-after-reload depends on an in-memory registry in `apps/web`.
   This is good enough for the current deployment shape, but it is not
   a distributed streaming system.
3. Orphaned uploaded files are accepted in the first implementation.
   This is an explicit trade-off in the current scope.

## Summary

The final design keeps chat UI inside `@repo/ui`, upgrades
`ChatMessage` into a durable streaming entity, removes the old MVP send
path, uses `apps/web` as the orchestration and persistence layer, and
extends `apps/agents` with structured stream events so tool and
confirmation state can render inside the active assistant message.
