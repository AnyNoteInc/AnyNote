import type { UploadHandler, UploadedFile } from './types'

/**
 * Shape of a single entry in Excalidraw's `BinaryFiles` map. We intentionally
 * avoid importing the full type from `@excalidraw/excalidraw` here so this
 * module stays framework-agnostic and doesn't drag Excalidraw's branded
 * `DataURL` / `FileId` types into the public type surface.
 */
export type ExcalidrawFile = {
  id: string
  dataURL: string
  mimeType: string
  created?: number
}

/**
 * Bridges Excalidraw's per-scene `BinaryFiles` map to the consumer's
 * `UploadHandler`. Each freshly-introduced file is uploaded exactly once;
 * subsequent calls to `syncFiles` with the same ids are cheap no-ops.
 */
export class FilesHandler {
  private readonly uploaded = new Map<string, UploadedFile>()
  private readonly inFlight = new Map<string, Promise<void>>()

  constructor(private readonly uploadHandler: UploadHandler) {}

  async syncFiles(files: Record<string, ExcalidrawFile>): Promise<void> {
    const tasks: Promise<void>[] = []
    for (const [id, file] of Object.entries(files)) {
      if (this.uploaded.has(id)) continue
      const existing = this.inFlight.get(id)
      if (existing) {
        tasks.push(existing)
        continue
      }
      const task = this.uploadOne(id, file).finally(() => {
        this.inFlight.delete(id)
      })
      this.inFlight.set(id, task)
      tasks.push(task)
    }
    await Promise.allSettled(tasks)
  }

  private async uploadOne(excalidrawId: string, file: ExcalidrawFile): Promise<void> {
    const blob = await dataUrlToBlob(file.dataURL)
    const filename = `excalidraw-${excalidrawId}.${extFromMime(file.mimeType)}`
    const result = await this.uploadHandler({ blob, filename })
    this.uploaded.set(excalidrawId, result)
  }
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl)
  return res.blob()
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/gif': 'gif',
  }
  return map[mime] ?? 'bin'
}
