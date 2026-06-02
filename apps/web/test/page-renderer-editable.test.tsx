// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// next/dynamic: return a passthrough that renders a sentinel echoing props.
vi.mock('next/dynamic', () => ({
  default: () => {
    return function Dyn(props: Record<string, unknown>) {
      return (
        <div
          data-testid="board"
          data-editable={String(props.editable)}
          data-mode={String(props.mode)}
        />
      )
    }
  },
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/trpc/client', () => ({
  trpc: {
    file: { attachToPage: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
    page: { listByWorkspace: { useQuery: () => ({ data: [] }) } },
    useUtils: () => ({ page: { listByWorkspace: { ensureData: vi.fn(async () => []) } } }),
  },
}))
vi.mock('@/lib/yjs-config', () => ({ resolveYjsUrl: () => 'ws://x', fetchYjsToken: vi.fn() }))
vi.mock('@/lib/drawio-config', () => ({ resolveDrawioUrl: () => 'http://x' }))
vi.mock('@/lib/upload-handler', () => ({ createUploadHandler: () => vi.fn() }))
vi.mock('@/hooks/use-outline-mode', () => ({ useOutlineMode: () => ['off'] }))
vi.mock('@/components/page/editor-context', () => ({
  usePageEditor: () => ({ setEditor: vi.fn() }),
}))
vi.mock('@/components/page/comments/comments-context', () => ({
  usePageCommentsContext: () => ({
    anchors: [],
    canComment: false,
    startNewThread: vi.fn(),
    openThreadPopover: vi.fn(),
    activeAnchor: null,
    panelOpen: false,
  }),
}))
vi.mock('@/components/page/use-reminder-sync', () => ({ useReminderSync: vi.fn() }))
vi.mock('@/components/page/comments/use-mention-search', () => ({
  useWorkspaceMentionSearch: () => vi.fn(),
}))

import { PageRenderer } from '@/components/page/page-renderer'

const user = { id: 'u1', name: 'U', color: '#000' }

function renderType(type: string) {
  return render(
    <PageRenderer
      page={{ id: 'p1', type: type as never, contentYjs: null }}
      workspaceId="w1"
      user={user}
      editable={false}
    />,
  )
}

describe('PageRenderer editable propagation', () => {
  afterEach(cleanup)

  it.each(['EXCALIDRAW', 'MERMAID', 'PLANTUML', 'LIKEC4', 'DRAWIO'])(
    'passes editable=false to %s board',
    (type) => {
      renderType(type)
      expect(screen.getByTestId('board').dataset.editable).toBe('false')
    },
  )

  it('passes mode=readonly to GENOGRAM when not editable', () => {
    renderType('GENOGRAM')
    expect(screen.getByTestId('board').dataset.mode).toBe('readonly')
  })
})
