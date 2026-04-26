import type { Readable } from 'node:stream'

export type PutOptions = {
  contentType: string
  size: number
}

export interface StorageClient {
  put(key: string, body: Readable | Buffer, opts: PutOptions): Promise<void>
  get(key: string): Promise<Readable>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
}
