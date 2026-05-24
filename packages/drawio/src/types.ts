export type DrawioUser = {
  id: string
  name: string
  color: string
}

export type DrawioBoardProps = {
  pageId: string
  yjsUrl: string
  yjsToken: () => Promise<string>
  initialContentYjs?: string | null
  /** Draw.io embed iframe origin (e.g. https://embed.diagrams.net). */
  drawioUrl: string
  /** Accepted for prop parity with other boards; draw.io's iframe can't render
   * collaborator cursors, so it is not wired to awareness here. */
  user?: DrawioUser
  /** Accepted for prop parity; draw.io's embed has no read-only toggle we wire. */
  editable?: boolean
  className?: string
}
