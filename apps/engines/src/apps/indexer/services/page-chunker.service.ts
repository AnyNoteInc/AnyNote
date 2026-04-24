import { Injectable } from "@nestjs/common"

const NON_INDEXABLE_BLOCK_TYPES = new Set(["heading", "image", "fileAttachment", "hiddenText"])

export type TiptapNode = {
  type: string
  text?: string
  content?: TiptapNode[]
  [k: string]: unknown
}

export type TiptapDoc =
  | {
      type: "doc"
      content?: TiptapNode[]
    }
  | null
  | undefined

@Injectable()
export class PageChunker {
  chunksFromDoc(doc: TiptapDoc): string[] {
    if (!doc || !Array.isArray(doc.content)) return []
    return doc.content
      .map((node) => this.collectText(node).trim())
      .filter((s) => s.length > 0)
  }

  private collectText(node: TiptapNode): string {
    if (NON_INDEXABLE_BLOCK_TYPES.has(node.type)) return ""
    if (node.type === "text") return node.text ?? ""
    if (!Array.isArray(node.content)) return ""
    return node.content.map((c) => this.collectText(c)).join(" ")
  }
}
