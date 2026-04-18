import type { Editor } from "@tiptap/core"

export type ConversionTarget =
  | "paragraph"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "heading-4"
  | "bulletList"
  | "orderedList"
  | "blockquote"
  | "codeBlock"

export const CONVERSION_LABELS: Record<ConversionTarget, string> = {
  paragraph: "Текст",
  "heading-1": "Заголовок 1",
  "heading-2": "Заголовок 2",
  "heading-3": "Заголовок 3",
  "heading-4": "Заголовок 4",
  bulletList: "Маркированный список",
  orderedList: "Нумерованный список",
  blockquote: "Цитата",
  codeBlock: "Код",
}

export function convertBlock(editor: Editor, target: ConversionTarget): boolean {
  const chain = editor.chain().focus()
  switch (target) {
    case "paragraph":
      return chain.setParagraph().run()
    case "heading-1":
      return chain.setNode("heading", { level: 1 }).run()
    case "heading-2":
      return chain.setNode("heading", { level: 2 }).run()
    case "heading-3":
      return chain.setNode("heading", { level: 3 }).run()
    case "heading-4":
      return chain.setNode("heading", { level: 4 }).run()
    case "bulletList":
      return chain.toggleBulletList().run()
    case "orderedList":
      return chain.toggleOrderedList().run()
    case "blockquote":
      return chain.toggleBlockquote().run()
    case "codeBlock":
      return chain.toggleCodeBlock().run()
  }
}
