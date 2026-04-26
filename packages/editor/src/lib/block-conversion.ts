import type { ComponentType, SVGProps } from 'react'
import type { Editor } from '@tiptap/core'

import {
  BulletListIcon,
  CodeIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  Heading4Icon,
  OrderedListIcon,
  QuoteIcon,
  TextIcon,
} from '../assets/index'

export type ConversionTarget =
  | 'paragraph'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'bulletList'
  | 'orderedList'
  | 'blockquote'
  | 'codeBlock'

export const CONVERSION_LABELS: Record<ConversionTarget, string> = {
  paragraph: 'Текст',
  'heading-1': 'Заголовок 1',
  'heading-2': 'Заголовок 2',
  'heading-3': 'Заголовок 3',
  'heading-4': 'Заголовок 4',
  bulletList: 'Маркированный список',
  orderedList: 'Нумерованный список',
  blockquote: 'Цитата',
  codeBlock: 'Код',
}

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

export const CONVERSION_ICONS: Record<ConversionTarget, IconComponent> = {
  paragraph: TextIcon,
  'heading-1': Heading1Icon,
  'heading-2': Heading2Icon,
  'heading-3': Heading3Icon,
  'heading-4': Heading4Icon,
  bulletList: BulletListIcon,
  orderedList: OrderedListIcon,
  blockquote: QuoteIcon,
  codeBlock: CodeIcon,
}

export function convertBlock(editor: Editor, target: ConversionTarget): boolean {
  const chain = editor.chain().focus()
  switch (target) {
    case 'paragraph':
      return chain.setParagraph().run()
    case 'heading-1':
      return chain.setNode('heading', { level: 1 }).run()
    case 'heading-2':
      return chain.setNode('heading', { level: 2 }).run()
    case 'heading-3':
      return chain.setNode('heading', { level: 3 }).run()
    case 'heading-4':
      return chain.setNode('heading', { level: 4 }).run()
    case 'bulletList':
      return chain.toggleBulletList().run()
    case 'orderedList':
      return chain.toggleOrderedList().run()
    case 'blockquote':
      return chain.toggleBlockquote().run()
    case 'codeBlock':
      return chain.toggleCodeBlock().run()
  }
}
