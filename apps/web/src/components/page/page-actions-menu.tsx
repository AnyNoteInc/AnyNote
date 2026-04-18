"use client"

import { useState, type MouseEvent } from "react"

import {
  Box,
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
} from "@repo/ui/components"

import { usePageActions } from "@/hooks/use-page-actions"
import { useFullWidth } from "@/hooks/use-full-width"

import { MovePageDialog } from "@/components/workspace/move-page-dialog"
import { trpc } from "@/trpc/client"

import { PageExportDialog } from "./page-export-dialog"

type Props = {
  pageId: string
  pageTitle: string | null
  workspaceId: string
  pageType: "TEXT" | "EXCALIDRAW"
  isFavorite: boolean
}

const menuItemSx = { gap: 1, fontSize: 13 } as const

export function PageActionsMenu({
  pageId,
  pageTitle,
  workspaceId,
  pageType,
  isFavorite,
}: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)

  const actions = usePageActions({ id: pageId, title: pageTitle }, workspaceId, isFavorite)
  const [fullWidth, setFullWidth] = useFullWidth(pageId)

  // Current page detail used by MovePageDialog as the "moved page".
  const pageQ = trpc.page.getById.useQuery({ id: pageId })
  const pagesQ = trpc.page.listByWorkspace.useQuery({ workspaceId })
  const movedPage = pageQ.data
  const pages = pagesQ.data ?? []

  const openMenu = (e: MouseEvent<HTMLElement>) => setAnchor(e.currentTarget)
  const closeMenu = () => setAnchor(null)

  const handleCopyLink = () => {
    void actions.copyLink()
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

        <MenuItem onClick={handleDuplicate} sx={menuItemSx}>
          <ListItemIcon>
            <ContentCopyIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Копия</ListItemText>
        </MenuItem>

        <MenuItem onClick={handleOpenMove} sx={menuItemSx}>
          <ListItemIcon>
            <MovingIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Переместить</ListItemText>
        </MenuItem>

        <MenuItem onClick={handleOpenDelete} sx={{ ...menuItemSx, color: "error.main" }}>
          <ListItemIcon>
            <DeleteIcon fontSize="small" sx={{ color: "error.main" }} />
          </ListItemIcon>
          <ListItemText>Удалить</ListItemText>
        </MenuItem>

        <Divider />

        <MenuItem onClick={handleToggleFullWidth} sx={menuItemSx}>
          <ListItemIcon>
            <HeightIcon fontSize="small" sx={{ transform: "rotate(90deg)" }} />
          </ListItemIcon>
          <ListItemText>Полноэкранный</ListItemText>
          <Box component="span" sx={{ ml: "auto" }}>
            <Switch checked={fullWidth} size="small" edge="end" />
          </Box>
        </MenuItem>

        <Divider />

        <MenuItem
          onClick={handleOpenExport}
          sx={menuItemSx}
          disabled={pageType !== "TEXT"}
        >
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
    </>
  )
}
