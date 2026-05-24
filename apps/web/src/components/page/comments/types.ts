export type UiComment = {
  id: string
  authorId: string | null
  authorName: string
  content: { text: string }
  createdAt: string | Date
}

export type UiThread = {
  id: string
  quotedText: string
  resolvedAt: string | Date | null
  comments: UiComment[]
}
