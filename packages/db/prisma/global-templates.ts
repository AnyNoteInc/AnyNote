/**
 * Built-in GLOBAL page templates seeded into `page_templates`.
 *
 * Each template's body is a Tiptap/ProseMirror JSON document. The AnyNote text
 * editor hydrates from the Yjs binary (`contentYjs`), so we transform the JSON
 * into a Y.Doc under the `default` field — the same field the editor's
 * Collaboration extension reads — and persist the encoded update alongside the
 * JSON snapshot (mirrors how welcome-page-content and page duplication work).
 */
import { TiptapTransformer } from '@hocuspocus/transformer'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Heading from '@tiptap/extension-heading'
import Code from '@tiptap/extension-code'
import { BulletList, ListItem } from '@tiptap/extension-list'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import * as Y from 'yjs'

const EXTENSIONS = [
  Document,
  Paragraph,
  Text,
  Heading,
  Code,
  BulletList,
  ListItem,
  TaskList,
  TaskItem.configure({ nested: true }),
]

type Doc = { type: 'doc'; content: unknown[] }

const h = (level: number, text: string) => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text }],
})
const p = (text = '') => ({
  type: 'paragraph',
  content: text ? [{ type: 'text', text }] : [],
})
const bullets = (items: string[]) => ({
  type: 'bulletList',
  content: items.map((text) => ({
    type: 'listItem',
    content: [p(text)],
  })),
})
const tasks = (items: string[]) => ({
  type: 'taskList',
  content: items.map((text) => ({
    type: 'taskItem',
    attrs: { checked: false },
    content: [p(text)],
  })),
})

export interface GlobalTemplateSeed {
  key: string
  title: string
  description: string
  icon: string
  category: string
  tagSlugs: string[]
  averageRating: number
  ratingCount: number
  doc: Doc
}

export const GLOBAL_TEMPLATES: GlobalTemplateSeed[] = [
  {
    key: 'meeting-notes',
    title: 'Заметки встречи',
    description: 'Повестка, участники, решения и задачи по итогам встречи.',
    icon: '📝',
    category: 'Работа',
    tagSlugs: ['career-building'],
    averageRating: 4.7,
    ratingCount: 185,
    doc: {
      type: 'doc',
      content: [
        h(1, 'Заметки встречи'),
        p('Дата: '),
        p('Участники: '),
        h(2, 'Повестка'),
        bullets(['Пункт 1', 'Пункт 2']),
        h(2, 'Обсуждение'),
        p(),
        h(2, 'Решения'),
        bullets(['Решение 1']),
        h(2, 'Задачи'),
        tasks(['Задача 1', 'Задача 2']),
      ],
    },
  },
  {
    key: 'project-plan',
    title: 'План проекта',
    description: 'Цели, этапы, сроки и риски проекта на одной странице.',
    icon: '📊',
    category: 'Проекты',
    tagSlugs: ['career-building', 'freelance'],
    averageRating: 4.8,
    ratingCount: 242,
    doc: {
      type: 'doc',
      content: [
        h(1, 'План проекта'),
        h(2, 'Цель'),
        p('Что мы хотим достичь и зачем.'),
        h(2, 'Этапы'),
        bullets(['Этап 1 — ', 'Этап 2 — ', 'Этап 3 — ']),
        h(2, 'Сроки'),
        p(),
        h(2, 'Риски'),
        bullets(['Риск 1', 'Риск 2']),
      ],
    },
  },
  {
    key: 'todo-list',
    title: 'Список задач',
    description: 'Простой чек-лист задач с приоритетами.',
    icon: '✅',
    category: 'Личное',
    tagSlugs: ['student-planner'],
    averageRating: 4.5,
    ratingCount: 298,
    doc: {
      type: 'doc',
      content: [
        h(1, 'Список задач'),
        h(2, 'Сегодня'),
        tasks(['Задача 1', 'Задача 2', 'Задача 3']),
        h(2, 'Позже'),
        tasks(['Задача 4']),
      ],
    },
  },
  {
    key: 'weekly-review',
    title: 'Еженедельный обзор',
    description: 'Итоги недели: достижения, проблемы и планы.',
    icon: '🗓️',
    category: 'Личное',
    tagSlugs: ['study-planner', 'career-building'],
    averageRating: 4.6,
    ratingCount: 134,
    doc: {
      type: 'doc',
      content: [
        h(1, 'Еженедельный обзор'),
        p('Неделя: '),
        h(2, 'Достижения'),
        bullets(['']),
        h(2, 'Что не получилось'),
        bullets(['']),
        h(2, 'Планы на следующую неделю'),
        tasks(['']),
      ],
    },
  },
  {
    key: 'crm-client-card',
    title: 'Карточка клиента / CRM',
    description: 'Контакты, история взаимодействия и следующие шаги по клиенту.',
    icon: '🧑‍💼',
    category: 'Продажи',
    tagSlugs: ['freelance', 'marketing'],
    averageRating: 4.9,
    ratingCount: 87,
    doc: {
      type: 'doc',
      content: [
        h(1, 'Карточка клиента'),
        h(2, 'Контакты'),
        bullets(['Компания: ', 'Контактное лицо: ', 'Email: ', 'Телефон: ']),
        h(2, 'Статус'),
        p(),
        h(2, 'История взаимодействия'),
        bullets(['']),
        h(2, 'Следующие шаги'),
        tasks(['']),
      ],
    },
  },
  {
    key: 'knowledge-base-article',
    title: 'Статья базы знаний',
    description: 'Структурированная статья: проблема, решение, примеры.',
    icon: '📚',
    category: 'База знаний',
    tagSlugs: ['career-building'],
    averageRating: 4.4,
    ratingCount: 56,
    doc: {
      type: 'doc',
      content: [
        h(1, 'Название статьи'),
        h(2, 'Обзор'),
        p('Краткое описание темы.'),
        h(2, 'Подробности'),
        p(),
        h(2, 'Примеры'),
        p(),
        h(2, 'См. также'),
        bullets(['']),
      ],
    },
  },
  {
    key: 'retrospective',
    title: 'Ретроспектива',
    description: 'Что прошло хорошо, что улучшить и какие действия предпринять.',
    icon: '🔁',
    category: 'Команда',
    tagSlugs: ['career-building'],
    averageRating: 4.6,
    ratingCount: 112,
    doc: {
      type: 'doc',
      content: [
        h(1, 'Ретроспектива'),
        p('Спринт / период: '),
        h(2, 'Что прошло хорошо'),
        bullets(['']),
        h(2, 'Что можно улучшить'),
        bullets(['']),
        h(2, 'Действия'),
        tasks(['']),
      ],
    },
  },
  {
    key: 'roadmap',
    title: 'Roadmap',
    description: 'Дорожная карта продукта по кварталам.',
    icon: '🛣️',
    category: 'Продукт',
    tagSlugs: ['marketing', 'career-building'],
    averageRating: 4.7,
    ratingCount: 163,
    doc: {
      type: 'doc',
      content: [
        h(1, 'Roadmap'),
        h(2, 'Сейчас'),
        bullets(['']),
        h(2, 'Следующее'),
        bullets(['']),
        h(2, 'Потом'),
        bullets(['']),
      ],
    },
  },
  {
    key: 'project-brief',
    title: 'Бриф проекта',
    description: 'Контекст, задачи, целевая аудитория и критерии успеха.',
    icon: '📋',
    category: 'Проекты',
    tagSlugs: ['marketing', 'freelance'],
    averageRating: 4.5,
    ratingCount: 78,
    doc: {
      type: 'doc',
      content: [
        h(1, 'Бриф проекта'),
        h(2, 'Контекст'),
        p(),
        h(2, 'Задачи'),
        bullets(['']),
        h(2, 'Целевая аудитория'),
        p(),
        h(2, 'Критерии успеха'),
        bullets(['']),
      ],
    },
  },
  {
    key: 'research-notes',
    title: 'Исследование / Research Notes',
    description: 'Вопросы, источники, находки и выводы исследования.',
    icon: '🔬',
    category: 'Исследования',
    tagSlugs: ['study-planner'],
    averageRating: 4.3,
    ratingCount: 41,
    doc: {
      type: 'doc',
      content: [
        h(1, 'Исследование'),
        h(2, 'Вопрос'),
        p('Что мы хотим выяснить.'),
        h(2, 'Источники'),
        bullets(['']),
        h(2, 'Находки'),
        bullets(['']),
        h(2, 'Выводы'),
        p(),
      ],
    },
  },
]

/** Encode a template doc to the Yjs binary the editor hydrates from. */
export function buildTemplateContentYjs(doc: Doc): Uint8Array {
  const ydoc = TiptapTransformer.toYdoc(doc, 'default', EXTENSIONS)
  const update = Y.encodeStateAsUpdate(ydoc)
  const out = new Uint8Array(new ArrayBuffer(update.byteLength))
  out.set(update)
  return out
}
