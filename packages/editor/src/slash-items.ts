import type { SlashCommandItem } from "./types"

const ITEMS: SlashCommandItem[] = [
  {
    id: "h1",
    label: "Heading 1",
    keywords: ["h1", "title"],
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run(),
  },
  {
    id: "h2",
    label: "Heading 2",
    keywords: ["h2"],
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run(),
  },
  {
    id: "h3",
    label: "Heading 3",
    keywords: ["h3"],
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run(),
  },
  {
    id: "paragraph",
    label: "Paragraph",
    keywords: ["text", "p"],
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode("paragraph").run(),
  },
  {
    id: "bullet",
    label: "Bullet list",
    keywords: ["ul", "list"],
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: "ordered",
    label: "Numbered list",
    keywords: ["ol"],
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: "task",
    label: "Task list",
    keywords: ["todo", "checkbox"],
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: "quote",
    label: "Quote",
    keywords: ["blockquote"],
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    id: "code",
    label: "Code block",
    keywords: ["code"],
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    id: "divider",
    label: "Divider",
    keywords: ["hr", "separator"],
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    id: "table",
    label: "Table",
    keywords: ["grid"],
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
