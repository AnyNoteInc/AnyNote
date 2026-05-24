export type CommentThreadAnchor = {
  id: string
  anchorStart: string // base64 Yjs RelativePosition
  anchorEnd: string
  resolvedAt: string | Date | null
}
