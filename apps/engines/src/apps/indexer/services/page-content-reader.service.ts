import { Injectable } from "@nestjs/common"

export type TiptapNode = {
  type: string
  text?: string
  content?: TiptapNode[]
  [k: string]: unknown
}

const SKIP = new Set(["heading", "hiddenText", "image", "fileAttachment"])

@Injectable()
export class PageContentReader {
  blocksFromDoc(doc: TiptapNode | null | undefined): Array<{ blockNumber: number; content: string }> {
    if (!doc || doc.type !== "doc" || !Array.isArray(doc.content)) return []
    const out: Array<{ blockNumber: number; content: string }> = []
    doc.content.forEach((node, idx) => {
      if (SKIP.has(node.type)) return
      const text = collectText(node).trim()
      if (!text) return
      out.push({ blockNumber: idx, content: text })
    })
    return out
  }
}

function collectText(node: TiptapNode): string {
  if (SKIP.has(node.type)) return ""
  if (node.type === "text") return node.text ?? ""
  if (!Array.isArray(node.content)) return ""
  return node.content.map(collectText).join(" ")
}
