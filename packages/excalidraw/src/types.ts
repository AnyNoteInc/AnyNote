export type UploadedFile = {
  id: string
  src: string
}

export type UploadHandler = (args: { blob: Blob; filename: string }) => Promise<UploadedFile>

export type BoardProps = {
  pageId: string
  workspaceId: string
  yjsUrl: string
  yjsToken: () => Promise<string>
  uploadHandler: UploadHandler
  editable?: boolean
  className?: string
}
