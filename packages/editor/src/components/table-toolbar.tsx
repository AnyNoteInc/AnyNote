"use client"

import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline"
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline"
import { IconButton, Paper, Stack, Tooltip } from "@mui/material"
import type { Editor } from "@tiptap/core"
import { BubbleMenu } from "@tiptap/react/menus"

type Props = { editor: Editor }

export function TableToolbar({ editor }: Props) {
  const shouldShow = () => editor.isActive("table")

  return (
    <BubbleMenu editor={editor} shouldShow={shouldShow} options={{ placement: "top" }}>
      <Paper elevation={6} sx={{ p: 0.25 }}>
        <Stack direction="row" spacing={0.25} alignItems="center">
          <Tooltip title="Добавить столбец слева">
            <IconButton
              size="small"
              onClick={() => editor.chain().focus().addColumnBefore().run()}
            >
              <AddCircleOutlineIcon fontSize="small" sx={{ transform: "rotate(-90deg)" }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Добавить столбец справа">
            <IconButton size="small" onClick={() => editor.chain().focus().addColumnAfter().run()}>
              <AddCircleOutlineIcon fontSize="small" sx={{ transform: "rotate(90deg)" }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Удалить столбец">
            <IconButton size="small" onClick={() => editor.chain().focus().deleteColumn().run()}>
              <DeleteOutlineIcon fontSize="small" sx={{ transform: "rotate(90deg)" }} />
            </IconButton>
          </Tooltip>

          <Tooltip title="Добавить строку сверху">
            <IconButton size="small" onClick={() => editor.chain().focus().addRowBefore().run()}>
              <AddCircleOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Добавить строку снизу">
            <IconButton size="small" onClick={() => editor.chain().focus().addRowAfter().run()}>
              <AddCircleOutlineIcon fontSize="small" sx={{ transform: "rotate(180deg)" }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Удалить строку">
            <IconButton size="small" onClick={() => editor.chain().focus().deleteRow().run()}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title="Удалить таблицу">
            <IconButton
              size="small"
              color="error"
              onClick={() => editor.chain().focus().deleteTable().run()}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Paper>
    </BubbleMenu>
  )
}
