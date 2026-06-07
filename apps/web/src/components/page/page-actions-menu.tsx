'use client'

import { useState, type MouseEvent } from 'react'

import {
  ArticleIcon,
  Box,
  BookmarkAddIcon,
  ContentCopyIcon,
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
} from '@repo/ui/components'

import { usePageActions } from '@/hooks/use-page-actions'
import { useFullWidth } from '@/hooks/use-full-width'

import { MovePageDialog } from '@/components/workspace/move-page-dialog'
import { SaveAsTemplateDialog } from '@/components/templates'
import type { PageItem } from '@/components/workspace/types'

import { PageExportDialog } from './page-export-dialog'

type Props = {
  pageId: string
  pageTitle: string | null
  pageIcon: string | null
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
  pageIcon,
  workspaceId,
  pageType,
  isFavorite,
  movedPage,
  pages,
}: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false)

  const actions = usePageActions({ id: pageId, title: pageTitle }, workspaceId, isFavorite)
  const [fullWidth, setFullWidth] = useFullWidth(pageId)

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

  const handleOpenSaveTemplate = () => {
    setSaveTemplateOpen(true)
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

        <MenuItem onClick={handleOpenSaveTemplate} sx={menuItemSx}>
          <ListItemIcon>
            <BookmarkAddIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Сохранить как шаблон</ListItemText>
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
      />

      <SaveAsTemplateDialog
        open={saveTemplateOpen}
        onClose={() => setSaveTemplateOpen(false)}
        workspaceId={workspaceId}
        pageId={pageId}
        defaultTitle={pageTitle ?? ''}
        defaultIcon={pageIcon}
      />
    </>
  )
}
