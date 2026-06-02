'use client'

import { useState, type MouseEvent } from 'react'

import {
  ArticleIcon,
  Box,
  Button,
  ButtonGroup,
  ContentCopyIcon,
  DehazeIcon,
  DeleteIcon,
  Divider,
  HeightIcon,
  IconButton,
  LinkIcon,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  MoreHorizIcon,
  MovingIcon,
  PublishIcon,
  Switch,
  TocIcon,
  Tooltip,
  VisibilityOffIcon,
} from '@repo/ui/components'

import { usePageActions } from '@/hooks/use-page-actions'
import { useFullWidth } from '@/hooks/use-full-width'
import { useOutlineMode } from '@/hooks/use-outline-mode'

import { MovePageDialog } from '@/components/workspace/move-page-dialog'
import type { PageItem } from '@/components/workspace/types'

import { PageExportDialog } from './page-export-dialog'

type Props = {
  pageId: string
  pageTitle: string | null
  workspaceId: string
  pageType:
    | 'TEXT'
    | 'EXCALIDRAW'
    | 'GENOGRAM'
    | 'MERMAID'
    | 'PLANTUML'
    | 'LIKEC4'
    | 'DRAWIO'
    | 'KANBAN'
  isFavorite: boolean
  // Full page row needed by MovePageDialog; undefined until parent's query settles.
  movedPage: PageItem | undefined
  pages: PageItem[]
}

const menuItemSx = { gap: 1, fontSize: 13 } as const

export function PageActionsMenu({
  pageId,
  pageTitle,
  workspaceId,
  pageType,
  isFavorite,
  movedPage,
  pages,
}: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)

  const actions = usePageActions({ id: pageId, title: pageTitle }, workspaceId, isFavorite)
  const [fullWidth, setFullWidth] = useFullWidth(pageId)
  const [outlineMode, setOutlineMode] = useOutlineMode(pageId)

  const openMenu = (e: MouseEvent<HTMLElement>) => setAnchor(e.currentTarget)
  const closeMenu = () => setAnchor(null)

  const handleCopyLink = () => {
    void actions.copyLink()
    closeMenu()
  }

  const handleCopyText = () => {
    // The Markdown export fetch can fail (network / permissions); there is no
    // toast surface in this menu, so swallow the rejection to avoid an unhandled
    // promise error rather than leaving it dangling.
    void actions.copyText().catch(() => {})
    closeMenu()
  }

  const handleDuplicate = () => {
    actions.duplicate()
    closeMenu()
  }

  const handleOpenMove = () => {
    setMoveOpen(true)
    closeMenu()
  }

  const handleOpenDelete = () => {
    actions.openDeleteConfirm()
    closeMenu()
  }

  const handleToggleFullWidth = () => {
    setFullWidth(!fullWidth)
  }

  const handleOpenExport = () => {
    setExportOpen(true)
    closeMenu()
  }

  return (
    <>
      <IconButton size="small" onClick={openMenu} aria-label="Действия страницы">
        <MoreHorizIcon fontSize="small" />
      </IconButton>

      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={closeMenu}>
        <MenuItem onClick={handleCopyLink} sx={menuItemSx}>
          <ListItemIcon>
            <LinkIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Копировать ссылку</ListItemText>
        </MenuItem>

        {pageType === 'TEXT' ? (
          <MenuItem onClick={handleCopyText} sx={menuItemSx}>
            <ListItemIcon>
              <ArticleIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Копировать текст</ListItemText>
          </MenuItem>
        ) : null}

        <MenuItem onClick={handleDuplicate} sx={menuItemSx}>
          <ListItemIcon>
            <ContentCopyIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Дублировать</ListItemText>
        </MenuItem>

        <MenuItem onClick={handleOpenMove} sx={menuItemSx}>
          <ListItemIcon>
            <MovingIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Переместить</ListItemText>
        </MenuItem>

        <MenuItem onClick={handleOpenDelete} sx={{ ...menuItemSx, color: 'error.main' }}>
          <ListItemIcon>
            <DeleteIcon fontSize="small" sx={{ color: 'error.main' }} />
          </ListItemIcon>
          <ListItemText>Удалить</ListItemText>
        </MenuItem>

        <Divider />

        <MenuItem onClick={handleToggleFullWidth} sx={menuItemSx} disabled={pageType !== 'TEXT'}>
          <ListItemIcon>
            <HeightIcon fontSize="small" sx={{ transform: 'rotate(90deg)' }} />
          </ListItemIcon>
          <ListItemText>Полноэкранный</ListItemText>
          <Box component="span" sx={{ ml: 'auto' }}>
            <Switch checked={fullWidth} size="small" edge="end" />
          </Box>
        </MenuItem>

        {pageType === 'TEXT' ? (
          <Box
            component="li"
            sx={{
              listStyle: 'none',
              px: 2,
              py: 1.25,
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              fontSize: 13,
            }}
          >
            <Box
              component="span"
              sx={{ color: 'text.primary', fontSize: 13, flex: 1, lineHeight: 1.4 }}
            >
              Навигация
            </Box>
            <ButtonGroup size="small" variant="outlined" aria-label="Режим навигации">
              <Tooltip title="Скрыть навигацию">
                <Button
                  onClick={() => setOutlineMode('off')}
                  variant={outlineMode === 'off' ? 'contained' : 'outlined'}
                  aria-label="Скрыть навигацию"
                  aria-pressed={outlineMode === 'off'}
                  sx={{ minWidth: 32, px: 1 }}
                >
                  <VisibilityOffIcon fontSize="small" />
                </Button>
              </Tooltip>
              <Tooltip title="Мини-навигация">
                <Button
                  onClick={() => setOutlineMode('mini')}
                  variant={outlineMode === 'mini' ? 'contained' : 'outlined'}
                  aria-label="Мини-навигация"
                  aria-pressed={outlineMode === 'mini'}
                  sx={{ minWidth: 32, px: 1 }}
                >
                  <DehazeIcon fontSize="small" />
                </Button>
              </Tooltip>
              <Tooltip title="Полная навигация">
                <Button
                  onClick={() => setOutlineMode('full')}
                  variant={outlineMode === 'full' ? 'contained' : 'outlined'}
                  aria-label="Полная навигация"
                  aria-pressed={outlineMode === 'full'}
                  sx={{ minWidth: 32, px: 1 }}
                >
                  <TocIcon fontSize="small" />
                </Button>
              </Tooltip>
            </ButtonGroup>
          </Box>
        ) : null}

        <Divider />

        <MenuItem onClick={handleOpenExport} sx={menuItemSx} disabled={pageType !== 'TEXT'}>
          <ListItemIcon>
            <PublishIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Экспортировать</ListItemText>
        </MenuItem>
      </Menu>

      {actions.dialogs}

      {movedPage ? (
        <MovePageDialog
          open={moveOpen}
          onClose={() => setMoveOpen(false)}
          page={movedPage}
          pages={pages}
          workspaceId={workspaceId}
        />
      ) : null}

      <PageExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        pageId={pageId}
        workspaceId={workspaceId}
      />
    </>
  )
}
