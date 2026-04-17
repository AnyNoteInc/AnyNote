export type UploadedFile = {
  id: string
  src: string
}

export type UploadHandler = (args: { blob: Blob; filename: string }) => Promise<UploadedFile>

export type BoardProps = {
  pageId: string
  yjsUrl: string
  yjsToken: () => Promise<string>
  uploadHandler: UploadHandler
  user?: { id: string; name: string; color: string }
  editable?: boolean
  className?: string
}
