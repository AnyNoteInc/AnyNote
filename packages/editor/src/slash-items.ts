import { createElement } from 'react'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import CalendarTodayIcon from '@mui/icons-material/CalendarToday'
import NotificationsIcon from '@mui/icons-material/Notifications'

import {
  BulletListIcon,
  CalloutIcon,
  CodeIcon,
  DividerIcon,
  FileIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  Heading4Icon,
  HiddenIcon,
  ImageIcon,
  MarkdownIcon,
  OrderedListIcon,
  PageLinkIcon,
  QuoteIcon,
  TableIcon,
  TaskListIcon,
  TextIcon,
  ToggleIcon,
} from './assets/index'
import { formatDateTimeText } from './lib/date-format'
import type { SlashCommandItem, SlashRange } from './types'

export type SlashMediaHandlers = {
  openDatePopover: (range: SlashRange) => void
  openFilePopover: (range: SlashRange) => void
  openMarkdownPopover: (range: SlashRange) => void
  openPageLinkPopover: (range: SlashRange) => void
  openReminderCreate?: (reminderId: string) => void
}

const buildItems = (handlers: SlashMediaHandlers): SlashCommandItem[] => [
  {
    id: 'text',
    group: 'base',
    label: 'Текст',
    keywords: ['text', 't', 'текст'],
    icon: createElement(TextIcon),
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode('paragraph').run(),
  },
  {
    id: 'h1',
    group: 'base',
    label: 'Заголовок 1',
    keywords: ['h1', 'title', 'заголовок'],
    icon: createElement(Heading1Icon),
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run(),
  },
  {
    id: 'h2',
    group: 'base',
    label: 'Заголовок 2',
    keywords: ['h2', 'заголовок'],
    icon: createElement(Heading2Icon),
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(),
  },
  {
    id: 'h3',
    group: 'base',
    label: 'Заголовок 3',
    keywords: ['h3', 'заголовок'],
    icon: createElement(Heading3Icon),
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run(),
  },
  {
    id: 'h4',
    group: 'base',
    label: 'Заголовок 4',
    keywords: ['h4', 'заголовок'],
    icon: createElement(Heading4Icon),
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 4 }).run(),
  },
  {
    id: 'bullet',
    group: 'base',
    label: 'Маркированный список',
    keywords: ['ul', 'list', 'список'],
    icon: createElement(BulletListIcon),
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: 'ordered',
    group: 'base',
    label: 'Нумерованный список',
    keywords: ['ol', 'номер'],
    icon: createElement(OrderedListIcon),
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: 'task',
    group: 'base',
    label: 'Список задач',
    keywords: ['todo', 'checkbox', 'чеклист', 'задача'],
    icon: createElement(TaskListIcon),
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: 'quote',
    group: 'base',
    label: 'Цитата',
    keywords: ['blockquote', 'цитата'],
    icon: createElement(QuoteIcon),
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    id: 'code',
    group: 'base',
    label: 'Код',
    keywords: ['code', 'pre', 'код'],
    icon: createElement(CodeIcon),
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    id: 'mermaid',
    group: 'base',
    label: 'Mermaid',
    description: 'Блок с диаграммой Mermaid',
    keywords: ['mermaid', 'diagram', 'диаграмма', 'график', 'схема'],
    icon: createElement(CodeIcon),
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setCodeBlock({ language: 'mermaid' }).run(),
  },
  {
    id: 'divider',
    group: 'base',
    label: 'Разделитель',
    keywords: ['hr', 'separator', 'разделитель'],
    icon: createElement(DividerIcon),
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    id: 'table',
    group: 'base',
    label: 'Таблица',
    keywords: ['grid', 'таблица'],
    icon: createElement(TableIcon),
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
  {
    id: 'callout',
    group: 'base',
    label: 'Выноска',
    description: 'Выделить текст',
    keywords: ['callout', 'выноска', 'заметка', 'info', 'выделить'],
    icon: createElement(CalloutIcon),
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'callout',
          attrs: { emoji: '💡' },
          content: [{ type: 'paragraph' }],
        })
        .run(),
  },
  {
    id: 'toggle',
    group: 'base',
    label: 'Переключатель',
    description: 'Скрываемое содержимое',
    keywords: ['toggle', 'collapse', 'переключатель', 'свернуть'],
    icon: createElement(ToggleIcon),
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'toggle',
          attrs: { open: true },
          content: [{ type: 'paragraph' }],
        })
        .run(),
  },
  {
    id: 'hidden',
    group: 'base',
    label: 'Скрытый текст',
    description: 'Скрывает содержимое под маской',
    keywords: ['hidden', 'mask', 'скрытый', 'спойлер'],
    icon: createElement(HiddenIcon),
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'hiddenText',
          // Stamp the insert time so the node view can distinguish a freshly
          // inserted block (show visible so the author can type) from a node
          // loaded from storage (show masked).
          attrs: { created: Date.now() },
          content: [{ type: 'paragraph' }],
        })
        .run(),
  },
  {
    id: 'date',
    group: 'base',
    label: 'Дата',
    description: 'Вставить дату',
    keywords: ['date', 'today', 'дата', 'сегодня'],
    icon: createElement(CalendarTodayIcon, { fontSize: 'small' }),
    run: ({ range }) => handlers.openDatePopover(range),
  },
  {
    id: 'datetime',
    group: 'base',
    label: 'Дата и время',
    description: 'Вставить дату и время',
    keywords: ['datetime', 'time', 'now', 'дата', 'время', 'сейчас'],
    icon: createElement(AccessTimeIcon, { fontSize: 'small' }),
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent(`${formatDateTimeText(new Date())} `)
        .run(),
  },
  {
    id: 'reminder',
    group: 'base',
    label: 'Напоминание',
    keywords: ['reminder', 'напоминание', 'дедлайн', 'deadline', 'todo'],
    icon: createElement(NotificationsIcon, { fontSize: 'small' }),
    run: ({ editor, range }) => {
      const id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'reminder',
          attrs: {
            id,
            dueAt: '',
            offsets: [0],
            audience: 'ME',
            label: null,
            recipients: [],
            doneAt: null,
          },
        })
        .run()
      handlers.openReminderCreate?.(id)
    },
  },
  {
    id: 'pageLink',
    group: 'base',
    label: 'Ссылка на страницу',
    description: 'Вставить ссылку на другую страницу',
    keywords: ['link', 'page', 'ссылка', 'страница'],
    icon: createElement(PageLinkIcon),
    run: ({ range }) => handlers.openPageLinkPopover(range),
  },
  {
    id: 'image',
    group: 'media',
    label: 'Картинка',
    description: 'Вставить пустой блок для загрузки изображения',
    keywords: ['image', 'img', 'картинка', 'изображение', 'фото'],
    icon: createElement(ImageIcon),
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'image', attrs: { src: null } })
        .run(),
  },
  {
    id: 'file',
    group: 'media',
    label: 'Файл',
    description: 'Загрузить файл',
    keywords: ['file', 'attachment', 'файл', 'документ', 'вложение'],
    icon: createElement(FileIcon),
    run: ({ range }) => handlers.openFilePopover(range),
  },
  {
    id: 'markdown',
    group: 'media',
    label: 'Markdown',
    description: 'Вставить содержимое .md файла',
    keywords: ['markdown', 'md', 'импорт'],
    icon: createElement(MarkdownIcon),
    run: ({ range }) => handlers.openMarkdownPopover(range),
  },
]

export const createSlashItems = (handlers: SlashMediaHandlers) => {
  const items = buildItems(handlers)
  return (query: string): SlashCommandItem[] => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (it) =>
        it.label.toLowerCase().includes(q) ||
        (it.keywords ?? []).some((k) => k.toLowerCase().includes(q)),
    )
  }
}
