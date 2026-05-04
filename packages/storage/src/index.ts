import type { StorageClient } from './contract.ts'
import { S3StorageClient } from './s3-client.ts'

export type { PutOptions, StorageClient } from './contract.ts'

type GlobalStorage = typeof globalThis & {
  __storage?: S3StorageClient
}

const g = globalThis as GlobalStorage

export const storage: StorageClient = g.__storage ?? new S3StorageClient()

if (process.env.NODE_ENV !== 'production') {
  g.__storage = storage as S3StorageClient
}
