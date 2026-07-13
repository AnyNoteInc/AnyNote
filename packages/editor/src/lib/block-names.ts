// Human-readable Russian labels for TipTap node types, used by the drag-handle
// menu header. Missing types fall back to the raw type string.

type NodeLike = { type: { name: string }; attrs?: Record<string, unknown> }

const BASE: Record<string, string> = {
  paragraph: 'Текст',
  bulletList: 'Маркированный список',
  orderedList: 'Нумерованный список',
  taskList: 'Задачи',
  blockquote: 'Цитата',
  codeBlock: 'Код',
  image: 'Изображение',
  video: 'Видео',
  audio: 'Аудио',
  fileAttachment: 'Файл',
  pageLink: 'Ссылка на страницу',
  callout: 'Подсказка',
  details: 'Переключатель',
  hiddenText: 'Скрытый текст',
}

export function blockDisplayName(node: NodeLike): string {
  const name = node.type.name
  if (name === 'heading') {
    const level = Number(node.attrs?.level ?? 1)
    return `Заголовок ${level}`
  }
  return BASE[name] ?? name
}

export const CONVERTIBLE_TYPES = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'blockquote',
  'codeBlock',
])

export function isConvertible(node: NodeLike): boolean {
  return CONVERTIBLE_TYPES.has(node.type.name)
}
