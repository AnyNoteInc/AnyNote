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
  Code,
  DateNode,
  Details,
  DetailsContent,
  DetailsSummary,
  FileAttachment,
  Highlight,
  HiddenText,
  LINK_HTML_ATTRIBUTES,
  Mention,
  PageLink,
  TextStyleKit,
  Underline,
} from '@repo/editor/extensions/server'

const lowlight = createLowlight(common)

export function buildServerExtensions() {
  return [
    StarterKit.configure({
      undoRedo: false,
      code: false,
      codeBlock: false,
      link: false,
      underline: false,
    }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: LINK_HTML_ATTRIBUTES,
    }),
    Code,
    Highlight.configure({ multicolor: true }),
    Underline,
    TextStyleKit.configure({
      backgroundColor: false,
      color: false,
      lineHeight: false,
      fontFamily: { types: ['textStyle'] },
      fontSize: { types: ['textStyle'] },
    }),
    Details.configure({ persist: true, HTMLAttributes: { class: 'anynote-details' } }),
    DetailsSummary.configure({ HTMLAttributes: { class: 'anynote-details__summary' } }),
    DetailsContent.configure({ HTMLAttributes: { class: 'anynote-details__content' } }),
    Mention.configure({
      HTMLAttributes: { class: 'mention' },
      renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
      renderHTML: ({ node }) => [
        'span',
        {
          class: 'mention',
          'data-type': 'mention',
          'data-id': node.attrs.id,
          'data-label': node.attrs.label,
        },
        `@${node.attrs.label ?? node.attrs.id}`,
      ],
    }),
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
    HiddenText,
    FileAttachment,
    PageLink,
    DateNode,
  ]
}
