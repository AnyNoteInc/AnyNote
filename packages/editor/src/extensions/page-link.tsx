'use client'

import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { Box } from '@mui/material'

import { PageLinkIcon } from '../assets/index'
import { PageLinkSchema } from './page-link.schema'

export type PageLinkAttrs = {
  pageId: string
  workspaceId: string
  title: string
}

export type PageLinkOptions = {
  onNavigate: (pageId: string) => void
}

function PageLinkView({ node, extension }: NodeViewProps) {
  const attrs = node.attrs as PageLinkAttrs
  const options = extension.options as PageLinkOptions

  const handleClick = (event: React.MouseEvent<HTMLSpanElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (attrs.pageId) options.onNavigate(attrs.pageId)
  }

  return (
    <NodeViewWrapper
      as="span"
      className="anynote-page-link-wrapper"
      contentEditable={false}
      data-type="page-link"
      data-page-id={attrs.pageId}
    >
      <Box
        component="span"
        onClick={handleClick}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          px: 0.5,
          mx: 0.25,
          borderRadius: 0.75,
          color: 'primary.main',
          cursor: 'pointer',
          textDecoration: 'underline',
          textUnderlineOffset: '3px',
          transition: 'background-color .15s',
          '&:hover': { backgroundColor: 'action.hover' },
        }}
      >
        <PageLinkIcon width={14} height={14} />
        <span>{attrs.title || 'Без названия'}</span>
      </Box>
    </NodeViewWrapper>
  )
}

export const PageLink = PageLinkSchema.extend<PageLinkOptions>({
  addOptions() {
    return { onNavigate: () => {} }
  },

  addNodeView() {
    return ReactNodeViewRenderer(PageLinkView)
  },
})
