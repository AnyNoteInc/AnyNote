import { createHash, randomBytes } from 'node:crypto'

import { FileStatus, Prisma, prisma, type PrismaClient } from '@repo/db'
import { bindOwnResponseUploadToken, type FormAccessResolver } from '@repo/domain'
import {
  normalizeFormLocator,
  parseFormVersionDocument,
  type FormQuestion,
  type FormVersionDocument,
} from '@repo/domain/database/forms'
import { storage, type StorageClient } from '@repo/storage'
import { domain } from '@repo/trpc/domain.ts'
import { verifyFormCaptcha } from '@repo/trpc/helpers/form-captcha'
import {
  formClientIp,
  formRateLimiter,
  type FormRateLimiter,
} from '@repo/trpc/helpers/form-rate-limit'
import {
  assertFormVersionContext,
  hashFormLocator,
  verifyFormVersionToken,
} from '@repo/trpc/helpers/form-version-token'
import { verifyFormOwnResponseToken } from '@repo/trpc/helpers/form-own-response-token'

import { extractExt, mediaMimeMatchesSniff, sniffImageMime } from '@/lib/file-validation'
import { getSession } from '@/lib/get-session'

export const runtime = 'nodejs'

const MAX_FORM_FILE_BYTES = 100 * 1_024 * 1_024
const MAX_MULTIPART_OVERHEAD_BYTES = 512 * 1_024
const MAX_REQUEST_BYTES = MAX_FORM_FILE_BYTES + MAX_MULTIPART_OVERHEAD_BYTES
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1_000
const STORAGE_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 120_000 } as const
const PUBLIC_ALLOWED_FIELDS = new Set(['file', 'versionToken', 'questionId'])
const OWN_ALLOWED_FIELDS = new Set(['file', 'ownResponseToken', 'questionId'])
const UNAVAILABLE_FORM_RATE_KEY = 'unavailable'

type UploadPrisma = Pick<
  PrismaClient,
  '$transaction' | 'file' | 'databaseFormUpload' | 'workspaceLimit'
>

type UploadDependencies = {
  prisma: UploadPrisma
  storage: StorageClient
  formAccess: FormAccessResolver
  verifyCaptcha: typeof verifyFormCaptcha
  rateLimiter: FormRateLimiter
  getActorUserId: () => Promise<string | null>
  now: () => Date
  tokenSecret: () => string
}

const defaults: UploadDependencies = {
  prisma,
  storage,
  formAccess: domain.formAccess,
  verifyCaptcha: verifyFormCaptcha,
  rateLimiter: formRateLimiter,
  getActorUserId: async () => (await getSession())?.user.id ?? null,
  now: () => new Date(),
  tokenSecret: () => process.env.FORM_TOKEN_SECRET ?? '',
}

const fail = (status: number, error: string) => Response.json({ error }, { status })

class UploadHttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function readBoundedBody(request: Request): Promise<Buffer> {
  const declaredLength = request.headers.get('content-length')
  if (declaredLength !== null) {
    const parsed = Number(declaredLength)
    if (!Number.isSafeInteger(parsed) || parsed < 0)
      throw new UploadHttpError(400, 'FORM_UPLOAD_INVALID')
    if (parsed > MAX_REQUEST_BYTES) throw new UploadHttpError(413, 'FORM_UPLOAD_TOO_LARGE')
  }

  if (request.body === null) throw new UploadHttpError(400, 'FORM_UPLOAD_INVALID')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel()
        throw new UploadHttpError(413, 'FORM_UPLOAD_TOO_LARGE')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, size)
}

async function boundedFormData(request: Request): Promise<FormData> {
  const contentType = request.headers.get('content-type')
  if (!contentType?.toLowerCase().startsWith('multipart/form-data;')) {
    throw new UploadHttpError(400, 'FORM_UPLOAD_INVALID')
  }
  const body = await readBoundedBody(request)
  try {
    const copiedBody = Uint8Array.from(body)
    return await new Request(request.url, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: copiedBody.buffer,
    }).formData()
  } catch {
    throw new UploadHttpError(400, 'FORM_UPLOAD_INVALID')
  }
}

function exactMultipartEnvelope(
  formData: FormData,
  ownResponse: boolean,
): {
  file: File
  contextToken: string
  questionId: string
} {
  const allowedFields = ownResponse ? OWN_ALLOWED_FIELDS : PUBLIC_ALLOWED_FIELDS
  const tokenField = ownResponse ? 'ownResponseToken' : 'versionToken'
  const entries = [...formData.entries()]
  if (entries.some(([key]) => !allowedFields.has(key))) {
    throw new UploadHttpError(400, 'FORM_UPLOAD_INVALID')
  }
  const files = formData.getAll('file')
  const tokens = formData.getAll(tokenField)
  const questions = formData.getAll('questionId')
  if (
    // One initiation leases one file. `maxFiles` is a per-response rule and is
    // enforced authoritatively over that response's lease-token array at submit;
    // a global live-lease count would let unrelated respondents block each other.
    files.length !== 1 ||
    tokens.length !== 1 ||
    questions.length !== 1 ||
    !(files[0] instanceof File) ||
    typeof tokens[0] !== 'string' ||
    typeof questions[0] !== 'string'
  ) {
    throw new UploadHttpError(400, 'FORM_UPLOAD_INVALID')
  }
  const contextToken = tokens[0]
  const questionId = questions[0].trim()
  if (
    contextToken.length === 0 ||
    contextToken.length > 4_096 ||
    questionId.length === 0 ||
    questionId.length > 64
  ) {
    throw new UploadHttpError(400, 'FORM_UPLOAD_INVALID')
  }
  return { file: files[0], contextToken, questionId }
}

type PublicOpenResolution = Extract<
  Awaited<ReturnType<FormAccessResolver['resolvePublished']>>,
  { status: 'OPEN' }
>
type OwnEditResolution = Extract<
  Awaited<ReturnType<FormAccessResolver['resolveOwnResponse']>>,
  { status: 'EDIT' }
>
type UploadAccess =
  | {
      kind: 'PUBLIC'
      locator: string
      actorUserId: string | null
      form: PublicOpenResolution['form']
      version: PublicOpenResolution['version']
    }
  | {
      kind: 'OWN'
      locator: string
      submissionId: string
      actorUserId: string
      form: OwnEditResolution['form']
      version: OwnEditResolution['version']
    }

async function resolveUploadAccess(
  formAccess: FormAccessResolver,
  locator: string,
  submissionId: string | undefined,
  actorUserId: string | null,
): Promise<UploadAccess | null> {
  if (submissionId === undefined) {
    const resolved = await formAccess.resolvePublished(locator, actorUserId)
    return resolved.status === 'OPEN'
      ? {
          kind: 'PUBLIC',
          locator: resolved.locator,
          actorUserId,
          form: resolved.form,
          version: resolved.version,
        }
      : null
  }
  if (actorUserId === null) return null
  const resolved = await formAccess.resolveOwnResponse(locator, submissionId, actorUserId)
  return resolved.status === 'EDIT'
    ? {
        kind: 'OWN',
        locator: resolved.locator,
        submissionId,
        actorUserId,
        form: resolved.form,
        version: resolved.version,
      }
    : null
}

function reachableSectionIds(document: FormVersionDocument): Set<string> {
  const reached = new Set([document.firstSectionId])
  let changed = true
  while (changed) {
    changed = false
    for (const transition of document.transitions) {
      if (
        reached.has(transition.fromSectionId) &&
        transition.target.kind === 'SECTION' &&
        !reached.has(transition.target.sectionId)
      ) {
        reached.add(transition.target.sectionId)
        changed = true
      }
    }
  }
  return reached
}

function fileQuestion(document: FormVersionDocument, questionId: string): FormQuestion | null {
  const reached = reachableSectionIds(document)
  const question = document.questions.find(({ id }) => id === questionId)
  if (
    question === undefined ||
    !reached.has(question.sectionId) ||
    question.property.kind !== 'PROPERTY' ||
    question.property.propertyType !== 'FILE' ||
    question.input.kind !== 'FILE'
  ) {
    return null
  }
  return question
}

const startsWith = (bytes: Uint8Array, prefix: readonly number[]): boolean =>
  bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value)

function isUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

function declaredMimeMatchesBytes(mimeType: string, bytes: Uint8Array): boolean {
  if (mimeType.startsWith('image/')) return sniffImageMime(bytes) === mimeType
  if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) {
    return mediaMimeMatchesSniff(mimeType, bytes)
  }
  if (mimeType === 'application/pdf') return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])
  if (mimeType === 'application/zip' || mimeType.includes('officedocument')) {
    return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])
  }
  if (mimeType === 'application/json') {
    if (!isUtf8Text(bytes)) return false
    try {
      JSON.parse(new TextDecoder().decode(bytes))
      return true
    } catch {
      return false
    }
  }
  if (mimeType.startsWith('text/')) return isUtf8Text(bytes)
  if (mimeType === 'application/octet-stream') {
    return (
      !isUtf8Text(bytes) &&
      sniffImageMime(bytes) === null &&
      !startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]) &&
      !startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])
    )
  }
  return false
}

function normalizedName(file: File): string {
  const name = file.name.split(/[\\/]/).at(-1)?.trim() ?? ''
  if (name.length === 0 || name.length > 512) throw new UploadHttpError(400, 'FORM_UPLOAD_INVALID')
  return name
}

function usageWhere(workspaceId: string, now: Date): Prisma.FileWhereInput {
  return {
    workspaceId,
    OR: [{ status: FileStatus.ACTIVE }, { status: FileStatus.PENDING, expiresAt: { gt: now } }],
  }
}

async function assertCapacity(
  client: Pick<PrismaClient, 'file' | 'workspaceLimit'>,
  input: {
    workspaceId: string
    newBytes: number
    now: Date
  },
): Promise<void> {
  // This helper also runs on Prisma's single-connection transaction client;
  // keep its queries sequential to avoid overlapping pg client.query calls.
  const usage = await client.file.aggregate({
    where: usageWhere(input.workspaceId, input.now),
    _sum: { fileSize: true },
  })
  const limits = await client.workspaceLimit.findUnique({
    where: { workspaceId: input.workspaceId },
  })
  if (limits === null) throw new UploadHttpError(500, 'FORM_UPLOAD_FAILED')
  if ((usage._sum?.fileSize ?? 0n) + BigInt(input.newBytes) > limits.maxFileBytes) {
    throw new UploadHttpError(413, 'WORKSPACE_STORAGE_LIMIT')
  }
}

export function createFormUploadHandler(overrides: Partial<UploadDependencies> = {}) {
  const dependencies: UploadDependencies = { ...defaults, ...overrides }

  return async function POST(
    request: Request,
    { params }: { params: Promise<{ locator: string; submissionId?: string }> },
  ): Promise<Response> {
    let objectPath: string | null = null
    let cleanupWorkspaceId: string | null = null
    let stored = false
    try {
      const { locator: rawLocator, submissionId } = await params
      const locator = normalizeFormLocator(rawLocator)
      if (locator === null) throw new UploadHttpError(404, 'FORM_UPLOAD_UNAVAILABLE')

      const contentLength = request.headers.get('content-length')
      if (contentLength !== null && Number(contentLength) > MAX_REQUEST_BYTES) {
        throw new UploadHttpError(413, 'FORM_UPLOAD_TOO_LARGE')
      }

      const clientIp = formClientIp(request.headers)
      const now = dependencies.now()
      if (!dependencies.rateLimiter.consume('upload-ip', `probe:${clientIp}`, now.getTime())) {
        throw new UploadHttpError(403, 'FORM_PROTECTED')
      }
      const actorUserId = await dependencies.getActorUserId()
      const access = await resolveUploadAccess(
        dependencies.formAccess,
        locator,
        submissionId,
        actorUserId,
      )
      const rateFormKey = access?.form.id ?? UNAVAILABLE_FORM_RATE_KEY
      if (
        !dependencies.rateLimiter.consume(
          'upload-ip',
          `form:${rateFormKey}:${clientIp}`,
          now.getTime(),
        )
      ) {
        throw new UploadHttpError(403, 'FORM_PROTECTED')
      }
      try {
        await dependencies.verifyCaptcha({
          token: request.headers.get('x-captcha-response'),
          action: 'form_upload',
          headers: request.headers,
        })
      } catch {
        throw new UploadHttpError(403, 'FORM_PROTECTED')
      }

      if (access === null) throw new UploadHttpError(404, 'FORM_UPLOAD_UNAVAILABLE')
      const envelope = exactMultipartEnvelope(await boundedFormData(request), access.kind === 'OWN')

      let publicToken: ReturnType<typeof verifyFormVersionToken> | null = null
      let ownToken: ReturnType<typeof verifyFormOwnResponseToken> | null = null
      let selectedVersion = access.version
      if (access.kind === 'OWN') {
        try {
          ownToken = verifyFormOwnResponseToken(
            envelope.contextToken,
            dependencies.tokenSecret(),
            now.getTime(),
          )
        } catch {
          throw new UploadHttpError(404, 'FORM_UPLOAD_UNAVAILABLE')
        }
        if (
          ownToken.locatorHash !== hashFormLocator(access.locator) ||
          ownToken.submissionId !== access.submissionId ||
          ownToken.actorUserId !== access.actorUserId ||
          ownToken.versionNumber !== access.version.versionNumber ||
          ownToken.schemaHash !== access.version.schemaHash ||
          ownToken.questionId !== envelope.questionId
        ) {
          throw new UploadHttpError(404, 'FORM_UPLOAD_UNAVAILABLE')
        }
      } else {
        try {
          publicToken = verifyFormVersionToken(
            envelope.contextToken,
            dependencies.tokenSecret(),
            now.getTime(),
          )
        } catch {
          throw new UploadHttpError(412, 'FORM_REFRESH_REQUIRED')
        }
        const resolvedVersion = await dependencies.formAccess.resolveVersion(
          access.form,
          publicToken.versionNumber,
        )
        if (resolvedVersion === null || resolvedVersion.formId !== access.form.id) {
          throw new UploadHttpError(412, 'FORM_REFRESH_REQUIRED')
        }
        selectedVersion = resolvedVersion
        try {
          assertFormVersionContext(
            publicToken,
            {
              locatorHash: hashFormLocator(access.locator),
              versionNumber: selectedVersion.versionNumber,
              schemaHash: selectedVersion.schemaHash,
              linkRevision: access.form.linkRevision,
              isCurrent: selectedVersion.id === access.form.publishedVersionId,
              acceptUntil: selectedVersion.acceptUntil,
            },
            now.getTime(),
          )
        } catch {
          throw new UploadHttpError(412, 'FORM_REFRESH_REQUIRED')
        }
      }

      let question: FormQuestion | null
      try {
        question = fileQuestion(
          parseFormVersionDocument(selectedVersion.schema),
          envelope.questionId,
        )
      } catch {
        question = null
      }
      if (question === null || question.input.kind !== 'FILE') {
        throw new UploadHttpError(404, 'FORM_UPLOAD_UNAVAILABLE')
      }

      const fileName = normalizedName(envelope.file)
      const mimeType = envelope.file.type.toLowerCase().split(';')[0]?.trim() ?? ''
      if (
        envelope.file.size === 0 ||
        envelope.file.size > question.input.maxBytesPerFile ||
        !question.input.allowedMimeTypes.includes(mimeType)
      ) {
        throw new UploadHttpError(400, 'FORM_UPLOAD_INVALID')
      }

      const capacity = {
        workspaceId: access.form.source.workspaceId,
        newBytes: envelope.file.size,
        now,
      }
      cleanupWorkspaceId = capacity.workspaceId
      await assertCapacity(dependencies.prisma, capacity)

      const bytes = Buffer.from(await envelope.file.arrayBuffer())
      if (bytes.length !== envelope.file.size || !declaredMimeMatchesBytes(mimeType, bytes)) {
        throw new UploadHttpError(400, 'FORM_UPLOAD_INVALID')
      }
      const hash = createHash('sha256').update(bytes).digest('hex')
      const ext = extractExt(fileName)
      objectPath = ext
        ? `forms/${access.form.id}/${hash.slice(0, 2)}/${hash}.${ext}`
        : `forms/${access.form.id}/${hash.slice(0, 2)}/${hash}`
      const expiresAt = new Date(now.getTime() + UPLOAD_TTL_MS)
      const randomUploadSecret = randomBytes(32).toString('base64url')
      const uploadToken =
        access.kind === 'OWN'
          ? bindOwnResponseUploadToken(randomUploadSecret, dependencies.tokenSecret(), {
              formId: access.form.id,
              versionId: selectedVersion.id,
              questionId: question.id,
              submissionId: access.submissionId,
              actorUserId: access.actorUserId,
            })
          : randomUploadSecret
      const uploadTokenHash = createHash('sha256').update(uploadToken).digest('hex')

      const created = await dependencies.prisma.$transaction(async (tx) => {
        const workspace = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT id FROM workspaces
          WHERE id = ${capacity.workspaceId}::uuid
          FOR UPDATE
        `)
        if (workspace.length !== 1) throw new UploadHttpError(404, 'FORM_UPLOAD_UNAVAILABLE')

        let lockedVersion
        if (access.kind === 'OWN') {
          const lockedResolved = await dependencies.formAccess.resolveOwnResponse(
            locator,
            access.submissionId,
            access.actorUserId,
          )
          if (
            lockedResolved.status !== 'EDIT' ||
            lockedResolved.form.id !== access.form.id ||
            lockedResolved.form.source.workspaceId !== capacity.workspaceId ||
            lockedResolved.version.id !== selectedVersion.id ||
            ownToken === null ||
            lockedResolved.version.versionNumber !== ownToken.versionNumber ||
            lockedResolved.version.schemaHash !== ownToken.schemaHash
          ) {
            throw new UploadHttpError(404, 'FORM_UPLOAD_UNAVAILABLE')
          }
          lockedVersion = lockedResolved.version
        } else {
          const lockedResolved = await dependencies.formAccess.resolvePublished(
            locator,
            actorUserId,
          )
          if (
            lockedResolved.status !== 'OPEN' ||
            lockedResolved.form.id !== access.form.id ||
            lockedResolved.form.source.workspaceId !== capacity.workspaceId ||
            publicToken === null
          ) {
            throw new UploadHttpError(404, 'FORM_UPLOAD_UNAVAILABLE')
          }
          lockedVersion = await dependencies.formAccess.resolveVersion(
            lockedResolved.form,
            publicToken.versionNumber,
          )
          if (lockedVersion === null || lockedVersion.id !== selectedVersion.id) {
            throw new UploadHttpError(412, 'FORM_REFRESH_REQUIRED')
          }
          try {
            assertFormVersionContext(
              publicToken,
              {
                locatorHash: hashFormLocator(lockedResolved.locator),
                versionNumber: lockedVersion.versionNumber,
                schemaHash: lockedVersion.schemaHash,
                linkRevision: lockedResolved.form.linkRevision,
                isCurrent: lockedVersion.id === lockedResolved.form.publishedVersionId,
                acceptUntil: lockedVersion.acceptUntil,
              },
              now.getTime(),
            )
          } catch {
            throw new UploadHttpError(412, 'FORM_REFRESH_REQUIRED')
          }
        }
        if (fileQuestion(parseFormVersionDocument(lockedVersion.schema), question.id) === null) {
          throw new UploadHttpError(404, 'FORM_UPLOAD_UNAVAILABLE')
        }
        await assertCapacity(tx, capacity)
        const referencesBeforePut = await tx.file.count({ where: { path: objectPath! } })
        try {
          // The workspace lock intentionally serializes quota accounting,
          // object publication and lease creation for public form uploads.
          await dependencies.storage.put(objectPath!, bytes, {
            contentType: mimeType,
            size: bytes.length,
          })
          stored = true
        } catch {
          throw new UploadHttpError(500, 'FORM_UPLOAD_FAILED')
        }

        try {
          const file = await tx.file.create({
            data: {
              userId: access.kind === 'OWN' ? access.actorUserId : access.form.createdById,
              workspaceId: capacity.workspaceId,
              name: fileName,
              ext,
              fileSize: BigInt(bytes.length),
              mimeType,
              hash,
              path: objectPath!,
              status: FileStatus.PENDING,
              isPublic: false,
              expiresAt,
            },
          })
          await tx.databaseFormUpload.create({
            data: {
              formId: access.form.id,
              versionId: selectedVersion.id,
              questionId: question.id,
              fileId: file.id,
              uploadTokenHash,
              expiresAt,
            },
          })
          return file
        } catch (error) {
          if (referencesBeforePut === 0) {
            try {
              await dependencies.storage.delete(objectPath!)
              stored = false
            } catch {
              // The outer recovery path retries while holding the same workspace lock.
            }
          } else {
            stored = false
          }
          throw error
        }
      }, STORAGE_TRANSACTION_OPTIONS)

      return Response.json(
        {
          uploadToken,
          file: {
            name: created.name,
            mimeType: created.mimeType,
            fileSize: created.fileSize.toString(),
            expiresAt: expiresAt.toISOString(),
          },
        },
        { status: 201 },
      )
    } catch (error) {
      if (stored && objectPath !== null && cleanupWorkspaceId !== null) {
        try {
          await dependencies.prisma.$transaction(async (tx) => {
            const workspace = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
              SELECT id FROM workspaces
              WHERE id = ${cleanupWorkspaceId}::uuid
              FOR UPDATE
            `)
            if (
              workspace.length === 1 &&
              (await tx.file.count({ where: { path: objectPath! } })) === 0
            ) {
              await dependencies.storage.delete(objectPath!)
            }
          }, STORAGE_TRANSACTION_OPTIONS)
        } catch {
          // Never replace the safe primary response with cleanup internals.
        }
      }
      if (error instanceof UploadHttpError) return fail(error.status, error.message)
      return fail(500, 'FORM_UPLOAD_FAILED')
    }
  }
}

export const POST = createFormUploadHandler()
