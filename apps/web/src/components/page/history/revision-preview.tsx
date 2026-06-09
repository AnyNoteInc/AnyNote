'use client'

import { Box, CircularProgress, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

/**
 * Recursively collect plain text from a Tiptap/ProseMirror JSON document. Block
 * boundaries (paragraph/heading/list-item/etc.) become newlines so the readonly
 * preview keeps a readable shape. We deliberately render text only — never the
 * live collaborative editor — so a historical snapshot can't write to the page.
 */
function extractPlainText(node: unknown): string {
  if (node == null) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(extractPlainText).join('')

  if (typeof node === 'object') {
    const n = node as { type?: unknown; text?: unknown; content?: unknown }
    if (typeof n.text === 'string') return n.text

    const inner = extractPlainText(n.content)
    const blockTypes = new Set([
      'paragraph',
      'heading',
      'listItem',
      'blockquote',
      'codeBlock',
      'taskItem',
    ])
    if (typeof n.type === 'string' && blockTypes.has(n.type)) {
      return inner ? `${inner}\n` : ''
    }
    return inner
  }
  return ''
}

export function RevisionPreview({ pageId, revisionId }: { pageId: string; revisionId: string }) {
  const previewQ = trpc.page.history.getRevisionPreview.useQuery(
    { pageId, revisionId },
    { staleTime: 60_000 },
  )

  if (previewQ.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
        <CircularProgress size={20} />
      </Box>
    )
  }

  if (previewQ.isError || !previewQ.data) {
    return (
      <Typography variant="body2" color="text.secondary">
        Не удалось загрузить предпросмотр версии.
      </Typography>
    )
  }

  // `content` is a recursive Prisma.JsonValue; reading it through the widened
  // `data` keeps TS from tripping its deep-instantiation limit on the walker.
  const data = previewQ.data as { content?: unknown }
  const text = extractPlainText(data.content).trim()

  return (
    <Box
      sx={{
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        p: 1.25,
        maxHeight: 280,
        overflow: 'auto',
      }}
    >
      {text ? (
        <Typography
          variant="body2"
          component="pre"
          sx={{
            m: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'inherit',
          }}
        >
          {text}
        </Typography>
      ) : (
        <Typography variant="body2" color="text.secondary">
          Текстовое содержимое для предпросмотра недоступно (например, для нетекстовой страницы).
        </Typography>
      )}
    </Box>
  )
}
