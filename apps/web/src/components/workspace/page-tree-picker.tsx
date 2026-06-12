'use client'

import { useState } from 'react'

import { Box, ChevronRightIcon, IconButton, Typography } from '@repo/ui/components'

import { PageIcon } from '@/components/page/page-icon'

import { type PageItem, orderSiblings } from './types'

export const PAGE_TREE_ROOT = '__root__' as const
export type PageTreeSelection = string | typeof PAGE_TREE_ROOT

type TreeItemProps = {
  page: PageItem
  pages: PageItem[]
  excludeIds: Set<string>
  onSelect: (id: PageTreeSelection) => void
  selectedId: PageTreeSelection | null
  depth: number
}

const selectedSx = { bgcolor: 'primary.main', color: 'primary.contrastText' } as const

function TreeItem({ page, pages, excludeIds, onSelect, selectedId, depth }: TreeItemProps) {
  const [expanded, setExpanded] = useState(false)
  const children = orderSiblings(
    pages.filter((p) => p.parentId === page.id && !excludeIds.has(p.id)),
  )
  const isSelected = selectedId === page.id

  return (
    <>
      <Box
        onClick={() => onSelect(page.id)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          pl: depth * 2 + 1,
          pr: 1,
          py: 0.5,
          cursor: 'pointer',
          borderRadius: 0.75,
          ...(isSelected ? selectedSx : {}),
          '&:hover': { bgcolor: isSelected ? 'primary.dark' : 'action.hover' },
          fontSize: 13,
        }}
      >
        {children.length > 0 ? (
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation()
              setExpanded((v) => !v)
            }}
            sx={{ p: 0, mr: 0.5 }}
          >
            <ChevronRightIcon
              sx={{
                fontSize: 16,
                transform: expanded ? 'rotate(90deg)' : 'none',
                transition: 'transform 0.15s',
              }}
            />
          </IconButton>
        ) : (
          <Box sx={{ width: 20, mr: 0.5 }} />
        )}
        {page.icon ? (
          <span style={{ marginRight: 6, display: 'inline-flex' }}>
            <PageIcon icon={page.icon} size={14} />
          </span>
        ) : null}
        <Typography variant="body2" noWrap>
          {page.title ?? 'Новая страница'}
        </Typography>
      </Box>
      {expanded &&
        children.map((child) => (
          <TreeItem
            key={child.id}
            page={child}
            pages={pages}
            excludeIds={excludeIds}
            onSelect={onSelect}
            selectedId={selectedId}
            depth={depth + 1}
          />
        ))}
    </>
  )
}

type Props = {
  pages: PageItem[]
  excludeIds?: Set<string>
  onSelect: (id: PageTreeSelection) => void
  selectedId: PageTreeSelection | null
  showRoot?: boolean
  rootLabel?: string
}

export function PageTreePicker({
  pages,
  excludeIds,
  onSelect,
  selectedId,
  showRoot = true,
  rootLabel = 'Корень',
}: Props) {
  const effectiveExclude = excludeIds ?? new Set<string>()
  const rootPages = orderSiblings(
    pages.filter((p) => p.parentId === null && !effectiveExclude.has(p.id)),
  )

  return (
    <>
      {showRoot ? (
        <Box
          onClick={() => onSelect(PAGE_TREE_ROOT)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            px: 1,
            py: 0.5,
            cursor: 'pointer',
            borderRadius: 0.75,
            fontWeight: 500,
            fontSize: 13,
            ...(selectedId === PAGE_TREE_ROOT ? selectedSx : {}),
            '&:hover': {
              bgcolor: selectedId === PAGE_TREE_ROOT ? 'primary.dark' : 'action.hover',
            },
          }}
        >
          {rootLabel}
        </Box>
      ) : null}
      {rootPages.map((p) => (
        <TreeItem
          key={p.id}
          page={p}
          pages={pages}
          excludeIds={effectiveExclude}
          onSelect={onSelect}
          selectedId={selectedId}
          depth={0}
        />
      ))}
    </>
  )
}

export function getDescendantIds(pageId: string, pages: PageItem[]): Set<string> {
  const ids = new Set<string>()
  const queue = [pageId]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const p of pages) {
      if (p.parentId === current && !ids.has(p.id)) {
        ids.add(p.id)
        queue.push(p.id)
      }
    }
  }
  return ids
}
