'use client'

import { createElement } from 'react'
import { IconButton, Paper, Stack, Tooltip } from '@mui/material'
import type { Editor } from '@tiptap/core'
import { BubbleMenu } from '@tiptap/react/menus'

import {
  DeleteColumnIcon,
  DeleteRowIcon,
  DeleteTableIcon,
  InsertColumnLeftIcon,
  InsertColumnRightIcon,
  InsertRowDownIcon,
  InsertRowUpIcon,
} from '../assets/index'

type Props = { editor: Editor }

export function TableToolbar({ editor }: Props) {
  const shouldShow = () => editor.isActive('table')

  return (
    <BubbleMenu editor={editor} shouldShow={shouldShow} options={{ placement: 'top' }}>
      <Paper elevation={6} sx={{ p: 0.25 }}>
        <Stack direction="row" spacing={0.25} alignItems="center">
          <Tooltip title="Добавить столбец слева">
            <IconButton size="small" onClick={() => editor.chain().focus().addColumnBefore().run()}>
              {createElement(InsertColumnLeftIcon)}
            </IconButton>
          </Tooltip>
          <Tooltip title="Добавить столбец справа">
            <IconButton size="small" onClick={() => editor.chain().focus().addColumnAfter().run()}>
              {createElement(InsertColumnRightIcon)}
            </IconButton>
          </Tooltip>
          <Tooltip title="Удалить столбец">
            <IconButton size="small" onClick={() => editor.chain().focus().deleteColumn().run()}>
              {createElement(DeleteColumnIcon)}
            </IconButton>
          </Tooltip>

          <Tooltip title="Добавить строку сверху">
            <IconButton size="small" onClick={() => editor.chain().focus().addRowBefore().run()}>
              {createElement(InsertRowUpIcon)}
            </IconButton>
          </Tooltip>
          <Tooltip title="Добавить строку снизу">
            <IconButton size="small" onClick={() => editor.chain().focus().addRowAfter().run()}>
              {createElement(InsertRowDownIcon)}
            </IconButton>
          </Tooltip>
          <Tooltip title="Удалить строку">
            <IconButton size="small" onClick={() => editor.chain().focus().deleteRow().run()}>
              {createElement(DeleteRowIcon)}
            </IconButton>
          </Tooltip>

          <Tooltip title="Удалить таблицу">
            <IconButton
              size="small"
              color="error"
              onClick={() => editor.chain().focus().deleteTable().run()}
            >
              {createElement(DeleteTableIcon)}
            </IconButton>
          </Tooltip>
        </Stack>
      </Paper>
    </BubbleMenu>
  )
}
