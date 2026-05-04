import type { Readable } from 'node:stream'

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'

import type { PutOptions, StorageClient } from './contract.ts'

type S3Config = {
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  forcePathStyle: boolean
}

const readConfig = (): S3Config => {
  const required = [
    'S3_ENDPOINT',
    'S3_REGION',
    'S3_ACCESS_KEY',
    'S3_SECRET_KEY',
    'S3_BUCKET',
  ] as const
  for (const name of required) {
    if (!process.env[name]) {
      throw new Error(`[@repo/storage] missing env var ${name}`)
    }
  }
  return {
    endpoint: process.env.S3_ENDPOINT!,
    region: process.env.S3_REGION!,
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!,
    bucket: process.env.S3_BUCKET!,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  }
}

export class S3StorageClient implements StorageClient {
  private client: S3Client
  private bucket: string

  constructor(config: S3Config = readConfig()) {
    this.bucket = config.bucket
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle,
    })
  }

  async put(key: string, body: Readable | Buffer, opts: PutOptions): Promise<void> {
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: opts.contentType,
        ContentLength: Buffer.isBuffer(body) ? opts.size : undefined,
      },
    })
    await upload.done()
  }

  async get(key: string): Promise<Readable> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
    if (!res.Body) {
      throw new Error(`[@repo/storage] empty body for key ${key}`)
    }
    // Safe cast — this client only runs in Node.js (route handlers use runtime = "nodejs").
    return res.Body as Readable
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
      return true
    } catch (err: unknown) {
      const error = err as { name?: string; $metadata?: { httpStatusCode?: number } }
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false
      }
      throw err
    }
  }
}
