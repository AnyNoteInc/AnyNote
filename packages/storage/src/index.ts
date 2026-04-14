import { S3StorageClient } from "./s3-client"

export type { PutOptions, StorageClient } from "./contract"
export { S3StorageClient } from "./s3-client"

type GlobalStorage = typeof globalThis & {
  __storage?: S3StorageClient
}

const g = globalThis as GlobalStorage

export const storage: S3StorageClient = g.__storage ?? new S3StorageClient()

if (process.env.NODE_ENV !== "production") {
  g.__storage = storage
}
