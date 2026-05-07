import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Typography from '@tiptap/extension-typography'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'

import {
  AnynoteTextColor,
  BlockBackground,
  Callout,
  FileAttachment,
  HiddenText,
  PageLink,
  Toggle,
} from '@repo/editor/extensions/server'

const lowlight = createLowlight(common)

export function buildServerExtensions() {
  return [
    StarterKit.configure({ undoRedo: false }),
    Link.configure({ openOnClick: false }),
    Typography,
    AnynoteTextColor,
    BlockBackground,
    Image,
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    CodeBlockLowlight.configure({ lowlight }),
    Callout,
    Toggle,
    HiddenText,
    FileAttachment,
    PageLink,
  ]
}
