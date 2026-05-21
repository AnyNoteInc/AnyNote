export type MermaidUser = {
  id: string
  name: string
  color: string
}

export type MermaidBoardProps = {
  pageId: string
  yjsUrl: string
  yjsToken: () => Promise<string>
  initialContentYjs?: string | null
  user?: MermaidUser
  editable?: boolean
  className?: string
}
