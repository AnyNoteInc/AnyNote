import { createElement } from "react"

import {
  BulletListIcon,
  CodeIcon,
  DividerIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  OrderedListIcon,
  ParagraphIcon,
  QuoteIcon,
  TableIcon,
  TaskListIcon,
} from "./assets/index"
import type { SlashCommandItem } from "./types"

const ITEMS: SlashCommandItem[] = [
  {
    id: "h1",
    label: "Заголовок 1",
    keywords: ["h1", "title", "заголовок"],
    icon: createElement(Heading1Icon),
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run(),
  },
  {
    id: "h2",
    label: "Заголовок 2",
    keywords: ["h2", "заголовок"],
    icon: createElement(Heading2Icon),
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run(),
  },
  {
    id: "h3",
    label: "Заголовок 3",
    keywords: ["h3", "заголовок"],
    icon: createElement(Heading3Icon),
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run(),
  },
  {
    id: "paragraph",
    label: "Абзац",
    keywords: ["text", "p", "параграф", "текст"],
    icon: createElement(ParagraphIcon),
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode("paragraph").run(),
  },
  {
    id: "bullet",
    label: "Маркированный список",
    keywords: ["ul", "list", "список"],
    icon: createElement(BulletListIcon),
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: "ordered",
    label: "Нумерованный список",
    keywords: ["ol", "номер"],
    icon: createElement(OrderedListIcon),
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: "task",
    label: "Список задач",
    keywords: ["todo", "checkbox", "чеклист", "задача"],
    icon: createElement(TaskListIcon),
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: "quote",
    label: "Цитата",
    keywords: ["blockquote", "цитата"],
    icon: createElement(QuoteIcon),
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    id: "code",
    label: "Код",
    keywords: ["code", "pre", "код"],
    icon: createElement(CodeIcon),
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    id: "divider",
    label: "Разделитель",
    keywords: ["hr", "separator", "разделитель"],
    icon: createElement(DividerIcon),
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    id: "table",
    label: "Таблица",
    keywords: ["grid", "таблица"],
    icon: createElement(TableIcon),
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
]

export const defaultSlashItems = (query: string): SlashCommandItem[] => {
  const q = query.trim().toLowerCase()
  if (!q) return ITEMS
  return ITEMS.filter(
    (it) =>
      it.label.toLowerCase().includes(q) ||
      (it.keywords ?? []).some((k) => k.toLowerCase().includes(q)),
  )
}
