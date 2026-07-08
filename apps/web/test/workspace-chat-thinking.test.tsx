// @vitest-environment jsdom

import type { ReactNode } from 'react'

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkspaceChatClient } from '@/components/workspace/chat/workspace-chat-client'

type ThinkingEffort = 'LOW' | 'MEDIUM' | 'HIGH'

// Only the props the probe touches; ChatThread's full prop type isn't exported.
type ProbeChatThreadProps = {
  composerThinking?: { effort: ThinkingEffort } | null
  onComposerSelectThinking?: (effort: ThinkingEffort) => void
}

// A persistent fake of the chat row that getChat resolves to. The createChat /
// updateChatSettings mocks mutate this object so getChat observes the same
// useThinking/thinkingEffort the backend would persist — this is what lets the
// test reproduce (or not) the hydration-clobbers-local-selection race.
type FakeChat = {
  id: string
  useThinking: boolean
  thinkingEffort: 'LOW' | 'MEDIUM' | 'HIGH' | null
  aiModelId: string | null
}

const NEW_CHAT_ID = '99999999-9999-4999-8999-999999999999'

const mocks = vi.hoisted(() => {
  const state: {
    chat: FakeChat | null
    createChat: ReturnType<typeof vi.fn>
    updateChatSettings: ReturnType<typeof vi.fn>
    invalidateListChats: ReturnType<typeof vi.fn>
    invalidateGetChat: ReturnType<typeof vi.fn>
  } = {
    chat: null,
    createChat: vi.fn(),
    updateChatSettings: vi.fn(),
    invalidateListChats: vi.fn(),
    invalidateGetChat: vi.fn(),
  }
  return state
})

// Mock the tRPC client. createChat persists whatever thinking settings the
// client threads into it (the fix), so getChat — which reads back from the same
// fake row — reflects the real backend behaviour.
vi.mock('@/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      chat: {
        listChats: { invalidate: mocks.invalidateListChats },
        getChat: { invalidate: mocks.invalidateGetChat },
      },
    }),
    chat: {
      getChat: {
        useQuery: (input: { chatId: string }, opts?: { enabled?: boolean }) => {
          if (!opts?.enabled || input.chatId !== mocks.chat?.id) {
            return { data: undefined, error: null }
          }
          return { data: { chat: mocks.chat, messages: [] }, error: null }
        },
      },
      createChat: {
        useMutation: () => ({ mutateAsync: mocks.createChat, isPending: false }),
      },
      updateChatSettings: {
        useMutation: () => ({ mutateAsync: mocks.updateChatSettings, isPending: false }),
      },
    },
    file: {
      listRecent: {
        useQuery: () => ({ data: [] }),
      },
    },
    aiSettings: {
      listAvailableModels: {
        useQuery: () => ({ data: [] }),
      },
    },
  },
}))

// Replace ChatThread with a tiny probe: it surfaces composerThinking as text and
// exposes a button that fires onComposerSelectThinking('MEDIUM'). The component
// under test (WorkspaceChatClient) is what we exercise — its handleSelectThinking,
// ensureChat/createChat wiring, and the hydration effect.
vi.mock('@repo/ui/components', () => ({
  Alert: ({ children }: { children: ReactNode }) => <div role="alert">{children}</div>,
  Box: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Stack: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChatThread: (props: ProbeChatThreadProps) => (
    <div>
      <div data-testid="thinking-probe">
        {props.composerThinking ? props.composerThinking.effort : 'none'}
      </div>
      <button type="button" onClick={() => props.onComposerSelectThinking?.('MEDIUM')}>
        select-medium
      </button>
    </div>
  ),
}))

vi.mock('@/components/chat/chat-link-renderer', () => ({
  renderChatLink: () => null,
}))

// useChatStream is unrelated to the thinking-chip flow; stub it so the component
// renders without a real SSE pipeline. ensureChat is still owned by the client.
vi.mock('@/components/workspace/chat/use-chat-stream', () => ({
  useChatStream: () => ({
    confirmResume: vi.fn(),
    error: null,
    isStreaming: false,
    messages: [],
    replaceFromServer: vi.fn(),
    resume: vi.fn(),
    send: vi.fn(),
  }),
}))

vi.mock('@/components/workspace/chat/use-draft-attachments', () => ({
  useDraftAttachments: () => ({
    attachments: [],
    error: null,
    hasPendingUploads: false,
    hasFailedUploads: false,
    uploadedAttachments: [],
    addUploaded: vi.fn(),
    clear: vi.fn(),
    syncComposerAttachments: vi.fn(),
  }),
}))

function probeEffort() {
  return screen.getByTestId('thinking-probe').textContent
}

describe('WorkspaceChatClient — thinking chip on a new chat', () => {
  beforeEach(() => {
    mocks.chat = null
    mocks.invalidateListChats.mockResolvedValue(undefined)
    mocks.invalidateGetChat.mockResolvedValue(undefined)
    mocks.updateChatSettings.mockResolvedValue({})
    // createChat persists the thinking settings the client passes in and flips
    // the fake getChat row to that new id — exactly like the backend.
    mocks.createChat.mockImplementation(
      async (input: Partial<FakeChat> & { workspaceId: string }) => {
        mocks.chat = {
          id: NEW_CHAT_ID,
          useThinking: input.useThinking ?? false,
          thinkingEffort: input.thinkingEffort ?? null,
          aiModelId: null,
        }
        return { id: NEW_CHAT_ID }
      },
    )
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows and keeps the thinking chip after selecting an effort on a brand-new chat', async () => {
    const user = userEvent.setup()
    render(
      <WorkspaceChatClient
        chatId={null}
        workspaceId="11111111-1111-4111-9111-111111111111"
        initialMessages={[]}
      />,
    )

    expect(probeEffort()).toBe('none')

    await user.click(screen.getByRole('button', { name: 'select-medium' }))

    // The chip (composerThinking) must be present AND survive the chat-creation
    // round-trip + getChat hydration — i.e. not be clobbered back to null.
    await waitFor(() => expect(probeEffort()).toBe('MEDIUM'))

    // createChat must have been told to persist the thinking settings, so the
    // freshly-created row is born with useThinking:true (no transient false to
    // clobber the chip).
    expect(mocks.createChat).toHaveBeenCalledWith(
      expect.objectContaining({ useThinking: true, thinkingEffort: 'MEDIUM' }),
    )
    expect(mocks.chat?.useThinking).toBe(true)
  })

  it('keeps the thinking chip when selecting an effort on an already-existing chat', async () => {
    // Existing chat with thinking off; selecting an effort must persist via
    // updateChatSettings and keep the chip showing.
    mocks.chat = {
      id: NEW_CHAT_ID,
      useThinking: false,
      thinkingEffort: null,
      aiModelId: null,
    }

    const user = userEvent.setup()
    render(
      <WorkspaceChatClient
        chatId={NEW_CHAT_ID}
        workspaceId="11111111-1111-4111-9111-111111111111"
        initialMessages={[]}
      />,
    )

    // Initial hydration from the existing row: thinking off.
    await waitFor(() => expect(probeEffort()).toBe('none'))

    await user.click(screen.getByRole('button', { name: 'select-medium' }))

    await waitFor(() => expect(probeEffort()).toBe('MEDIUM'))
    // Existing chat path persists through updateChatSettings (no new chat row).
    expect(mocks.updateChatSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: NEW_CHAT_ID,
        useThinking: true,
        thinkingEffort: 'MEDIUM',
      }),
    )
    expect(mocks.createChat).not.toHaveBeenCalled()
  })
})
