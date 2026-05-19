'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, type MouseEvent } from 'react'
import {
  AccountTreeIcon,
  Box,
  BrushIcon,
  ChevronRightIcon,
  DescriptionIcon,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  MoreHorizIcon,
  Typography,
  AddIcon,
  ViewKanbanIcon,
} from '@repo/ui/components'
import type { PageType } from '@repo/db'
import { trpc } from '@/trpc/client'
import { PageContextMenu } from './page-context-menu'
import { MovePageDialog } from './move-page-dialog'
import { type PageItem, orderSiblings } from './types'

type CreatablePageType = Extract<PageType, 'TEXT' | 'EXCALIDRAW' | 'GENOGRAM' | 'KANBAN'>

type Props = {
  workspaceId: string
  pages: PageItem[]
  favoritePageIds: Set<string>
}

function CreatePageMenu({
  anchorEl,
  onClose,
  onCreate,
}: {
  anchorEl: HTMLElement | null
  onClose: () => void
  onCreate: (type: CreatablePageType) => void
}) {
  return (
    <Menu
      anchorEl={anchorEl}
      open={Boolean(anchorEl)}
      onClose={onClose}
      onClick={(e) => e.stopPropagation()}
    >
      <MenuItem
        onClick={() => {
          onCreate('TEXT')
          onClose()
        }}
      >
        <ListItemIcon>
          <DescriptionIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary="Текст" />
      </MenuItem>
      <MenuItem
        onClick={() => {
          onCreate('EXCALIDRAW')
          onClose()
        }}
      >
        <ListItemIcon>
          <BrushIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary="Холст" />
      </MenuItem>
      <MenuItem
        onClick={() => {
          onCreate('GENOGRAM')
          onClose()
        }}
      >
        <ListItemIcon>
          <AccountTreeIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary="Генограмма" />
      </MenuItem>
      <MenuItem
        onClick={() => {
          onCreate('KANBAN')
          onClose()
        }}
      >
        <ListItemIcon>
          <ViewKanbanIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary="Канбан" />
      </MenuItem>
    </Menu>
  )
}

function PageTreeItem({
  page,
  pages,
  workspaceId,
  favoritePageIds,
  depth,
}: {
  page: PageItem
  pages: PageItem[]
  workspaceId: string
  favoritePageIds: Set<string>
  depth: number
}) {
  const pathname = usePathname()
  const router = useRouter()
  const utils = trpc.useUtils()

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [createAnchor, setCreateAnchor] = useState<HTMLElement | null>(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const [expanded, setExpanded] = useState(true)

  const isActive = pathname === `/workspaces/${workspaceId}/pages/${page.id}`

  const createPage = trpc.page.create.useMutation({
    onSuccess: async (data) => {
      await utils.page.listByWorkspace.invalidate({ workspaceId })
      router.push(`/workspaces/${workspaceId}/pages/${data.id}`)
    },
  })

  const children = orderSiblings(pages.filter((p) => p.parentId === page.id))

  return (
    <>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          pr: 0.5,
          pl: depth * 1.5,
          borderRadius: 0.75,
          bgcolor: isActive ? 'action.selected' : 'transparent',
          '&:hover': { bgcolor: isActive ? 'action.selected' : 'action.hover' },
          '&:hover .page-actions': { visibility: 'visible' },
        }}
      >
        {children.length > 0 ? (
          <IconButton size="small" onClick={() => setExpanded((v) => !v)} sx={{ p: 0, mr: 0.25 }}>
            <ChevronRightIcon
              sx={{
                fontSize: 16,
                transform: expanded ? 'rotate(90deg)' : 'none',
                transition: 'transform 0.15s',
              }}
            />
          </IconButton>
        ) : (
          <Box sx={{ width: 20 }} />
        )}
        <Link
          href={`/workspaces/${workspaceId}/pages/${page.id}`}
          onClick={(e) => e.stopPropagation()}
          style={{ textDecoration: 'none', flex: 1, minWidth: 0, display: 'flex', gap: 4 }}
        >
          {page.icon ? (
            <Typography variant="body2" component="span" sx={{ flexShrink: 0, lineHeight: '28px' }}>
              {page.icon}
            </Typography>
          ) : null}
          <Typography
            variant="body2"
            noWrap
            sx={{
              py: 0.5,
              color: isActive ? 'text.primary' : 'text.secondary',
            }}
          >
            {page.title ?? 'Новая страница'}
          </Typography>
        </Link>
        <Box
          className="page-actions"
          sx={{
            display: 'flex',
            visibility: menuAnchor || createAnchor ? 'visible' : 'hidden',
            flexShrink: 0,
          }}
        >
          <IconButton
            size="small"
            onClick={(e: MouseEvent<HTMLElement>) => {
              e.stopPropagation()
              setCreateAnchor(e.currentTarget)
            }}
            sx={{ p: 0.25 }}
          >
            <AddIcon sx={{ fontSize: 16 }} />
          </IconButton>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation()
              setMenuAnchor(e.currentTarget as HTMLElement)
            }}
            sx={{ p: 0.25 }}
          >
            <MoreHorizIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
      </Box>

      {expanded &&
        children.map((child) => (
          <PageTreeItem
            key={child.id}
            page={child}
            pages={pages}
            workspaceId={workspaceId}
            favoritePageIds={favoritePageIds}
            depth={depth + 1}
          />
        ))}

      <CreatePageMenu
        anchorEl={createAnchor}
        onClose={() => setCreateAnchor(null)}
        onCreate={(type) =>
          createPage.mutate({
            workspaceId,
            parentId: page.id,
            type,
          })
        }
      />

      <PageContextMenu
        anchorEl={menuAnchor}
        onClose={() => setMenuAnchor(null)}
        page={page}
        workspaceId={workspaceId}
        isFavorite={favoritePageIds.has(page.id)}
        onOpenMoveDialog={() => {
          setMenuAnchor(null)
          setMoveOpen(true)
        }}
      />

      <MovePageDialog
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        page={page}
        pages={pages}
        workspaceId={workspaceId}
      />
    </>
  )
}

export function PageTreeSection({ workspaceId, pages: initialPages, favoritePageIds }: Props) {
  const [createAnchor, setCreateAnchor] = useState<HTMLElement | null>(null)
  const router = useRouter()
  const utils = trpc.useUtils()

  const pagesQuery = trpc.page.listByWorkspace.useQuery({ workspaceId })
  const pages = pagesQuery.data ?? initialPages

  const createPage = trpc.page.create.useMutation({
    onSuccess: async (data) => {
      await utils.page.listByWorkspace.invalidate({ workspaceId })
      router.push(`/workspaces/${workspaceId}/pages/${data.id}`)
    },
  })

  const rootPages = orderSiblings(pages.filter((p) => p.parentId === null))

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
          gap: 1,
        }}
      >
        <Typography variant="overline" sx={{ color: 'text.secondary', letterSpacing: '0.06em' }}>
          Страницы
        </Typography>
        <IconButton
          aria-label="Новая страница"
          size="small"
          onClick={(e: MouseEvent<HTMLElement>) => setCreateAnchor(e.currentTarget)}
        >
          <AddIcon sx={{ fontSize: 16 }} />
        </IconButton>
        <CreatePageMenu
          anchorEl={createAnchor}
          onClose={() => setCreateAnchor(null)}
          onCreate={(type) =>
            createPage.mutate({
              workspaceId,
              parentId: null,
              type,
            })
          }
        />
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {rootPages.map((page) => (
          <PageTreeItem
            key={page.id}
            page={page}
            pages={pages}
            workspaceId={workspaceId}
            favoritePageIds={favoritePageIds}
            depth={0}
          />
        ))}
      </Box>
    </Box>
  )
}
