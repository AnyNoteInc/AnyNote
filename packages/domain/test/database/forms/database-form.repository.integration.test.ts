import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PageType, prisma } from '@repo/db'

import { PrismaUnitOfWork, type Db, type UnitOfWork } from '../../../src/shared/unit-of-work.ts'
import { lockWorkspaceForMutation } from '../../../src/shared/workspace-transaction-lock.ts'
import {
  DatabaseFormRepository,
  type EnqueueFormSubmittedEventRecord,
  type LockFormSubmissionAuthoritiesRecord,
} from '../../../src/database/forms/database-form.repository.ts'
import { FormSubmissionService } from '../../../src/database/forms/form-submission.service.ts'
import { FormAccessResolver } from '../../../src/database/forms/form-access-resolver.ts'
import { DatabaseRepository } from '../../../src/database/repositories/database.repository.ts'
import { DatabaseService } from '../../../src/database/services/database.service.ts'
import { PageRepository } from '../../../src/pages/repositories/pages.repository.ts'
import type { BillingService } from '../../../src/billing/services/billing.service.ts'
import type { CollectionService } from '../../../src/collections/services/collection.service.ts'
import { DatabaseFormService } from '../../../src/database/forms/database-form.service.ts'
import { PeopleRepository } from '../../../src/people/repositories/people.repository.ts'
import { PeopleService } from '../../../src/people/services/people.service.ts'
import {
  FORM_SCHEMA_VERSION,
  type FormVersionDocument,
} from '../../../src/database/forms/public.ts'

const RUN = randomUUID().slice(0, 8)
const EMAIL = `database-form-repository-${RUN}@example.test`
const submittedAt = new Date('2026-07-16T00:00:00.000Z')

function uuid7(): string {
  const chars = [...randomUUID()]
  chars[14] = '7'
  chars[19] = '8'
  return chars.join('')
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function settlesWithin<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('CONCURRENT_LOCK_TIMEOUT')), 2_000),
    ),
  ])
}

class QueryObservingUnitOfWork implements UnitOfWork {
  private readonly inner = new PrismaUnitOfWork(prisma)
  private readonly observe: (sql: string) => void

  constructor(observe: (sql: string) => void) {
    this.observe = observe
  }

  transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.inner.transaction(fn)
  }

  client(): Db {
    const client = this.inner.client()
    return new Proxy(client, {
      get: (target, property, receiver) => {
        const value = Reflect.get(target, property, receiver)
        if (property !== '$queryRaw' || typeof value !== 'function') return value
        return (...args: unknown[]) => {
          const query = args[0]
          if (query !== null && typeof query === 'object' && 'strings' in query) {
            this.observe((query as { strings: readonly string[] }).strings.join(''))
          }
          return Reflect.apply(value, target, args)
        }
      },
    }) as Db
  }
}

const errorDetails = (reason: unknown): string => {
  let serialized = ''
  try {
    serialized = JSON.stringify(reason)
  } catch {
    // String(reason) below is still enough for Prisma's rendered database error.
  }
  return `${String(reason)} ${serialized}`
}

const documentFor = (propertyId = 'property-1'): FormVersionDocument => ({
  schemaVersion: FORM_SCHEMA_VERSION,
  firstSectionId: 'section-1',
  presentation: {
    title: 'Integration form',
    submitButtonText: 'Send',
    hideAnyNoteBranding: false,
  },
  sections: [{ id: 'section-1', title: 'Questions', questionIds: ['question-1'] }],
  questions: [
    {
      id: 'question-1',
      sectionId: 'section-1',
      property: { kind: 'PROPERTY', propertyId, propertyType: 'TEXT' },
      label: 'Name',
      required: false,
      syncWithPropertyName: false,
      input: { kind: 'TEXT', multiline: false, maxLength: 200 },
    },
  ],
  transitions: [
    {
      id: 'transition-1',
      fromSectionId: 'section-1',
      priority: 0,
      when: null,
      target: { kind: 'ENDING', endingId: 'ending-1' },
    },
  ],
  endings: [{ id: 'ending-1', title: 'Done' }],
})

const fileDocumentFor = (propertyId: string): FormVersionDocument => ({
  ...documentFor(propertyId),
  questions: [
    {
      ...documentFor(propertyId).questions[0]!,
      property: { kind: 'PROPERTY', propertyId, propertyType: 'FILE' },
      input: {
        kind: 'FILE',
        allowedMimeTypes: ['text/plain'],
        maxBytesPerFile: 1_000,
        maxFiles: 1,
      },
    },
  ],
})

const relationDocumentFor = (propertyId: string): FormVersionDocument => ({
  ...documentFor(propertyId),
  questions: [
    {
      ...documentFor(propertyId).questions[0]!,
      property: { kind: 'PROPERTY', propertyId, propertyType: 'RELATION' },
      input: { kind: 'RELATION', maxSelections: 1 },
    },
  ],
})

let userId = ''
let workspaceId = ''
let sourceId = ''
let sourcePageId = ''
let paginationFormId = ''

const repository = new DatabaseFormRepository(new PrismaUnitOfWork(prisma))

class FailingOutboxFormRepository extends DatabaseFormRepository {
  override async enqueueFormSubmittedEvent(input: EnqueueFormSubmittedEventRecord): Promise<void> {
    await super.enqueueFormSubmittedEvent(input)
    throw new Error('TEST_OUTBOX_FAILURE')
  }
}

async function createForm(routeSuffix: string) {
  return prisma.databaseForm.create({
    data: {
      sourceId,
      routeKey: `anf_it_${RUN}_${routeSuffix}`,
      draftSchema: documentFor(),
      createdById: userId,
    },
  })
}

function productionSubmissionService(
  uow: UnitOfWork,
  formRepo: DatabaseFormRepository = new DatabaseFormRepository(uow),
): FormSubmissionService {
  const access = new FormAccessResolver(
    formRepo,
    { assertMembership: async () => ({ userId, workspaceId, role: 'OWNER' }) } as never,
    () => submittedAt,
  )
  return new FormSubmissionService(
    formRepo,
    new DatabaseRepository(uow),
    new PageRepository(uow),
    uow,
    access,
    () => submittedAt,
  )
}

function productionSubmissionInput(routeKey: string, idempotencyKey: string, value: unknown) {
  return {
    input: { locator: routeKey, idempotencyKey, answers: { 'question-1': value } },
    token: {
      locatorHash: createHash('sha256').update(routeKey).digest('hex'),
      versionNumber: 1,
      schemaHash: '',
      linkRevision: 1,
    },
  }
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      name: `Form Repository ${RUN}`,
      firstName: 'Form',
      lastName: 'Repository',
      email: EMAIL,
    },
  })
  userId = user.id
  const workspace = await prisma.workspace.create({
    data: { name: `Form Repository ${RUN}`, createdById: user.id },
  })
  workspaceId = workspace.id
  const sourcePage = await prisma.page.create({
    data: {
      workspaceId,
      type: PageType.DATABASE,
      title: 'Responses',
      createdById: user.id,
    },
  })
  sourcePageId = sourcePage.id
  const source = await prisma.databaseSource.create({
    data: { workspaceId, pageId: sourcePage.id, title: 'Responses' },
  })
  sourceId = source.id
  const form = await createForm('pagination')
  paginationFormId = form.id
  const version = await prisma.databaseFormVersion.create({
    data: {
      formId: form.id,
      versionNumber: 1,
      schema: documentFor(),
      schemaHash: 'd'.repeat(64),
      publishedById: user.id,
      publishedAt: submittedAt,
    },
  })
  const submissionIds = Array.from({ length: 5 }, uuid7)
  for (const [index, submissionId] of submissionIds.entries()) {
    const itemPage = await prisma.page.create({
      data: {
        id: uuid7(),
        workspaceId,
        title: `Response ${index + 1}`,
        createdById: user.id,
      },
    })
    const row = await prisma.databaseRow.create({
      data: {
        id: uuid7(),
        sourceId,
        pageId: itemPage.id,
        position: index * 1024,
        createdById: user.id,
        updatedById: user.id,
      },
    })
    await prisma.databaseFormSubmission.create({
      data: {
        id: submissionId,
        formId: form.id,
        versionId: version.id,
        rowId: row.id,
        respondentUserId: user.id,
        endingId: 'ending-1',
        idempotencyKey: uuid7(),
        submittedAt,
      },
    })
  }
})

afterAll(async () => {
  if (workspaceId) await prisma.workspace.deleteMany({ where: { id: workspaceId } })
  await prisma.user.deleteMany({
    where: { email: { contains: `database-form-repository-${RUN}` } },
  })
})

describe('DatabaseFormRepository real PostgreSQL behavior', () => {
  it('paginates equal-timestamp UUIDv7 submissions without gaps or duplicates', async () => {
    const expected = (
      await prisma.databaseFormSubmission.findMany({
        where: { formId: paginationFormId },
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      })
    ).map(({ id }) => id)

    const first = await repository.listResponses({ formId: paginationFormId, limit: 2 })
    expect(first.items.map(({ id }) => id)).toEqual(expected.slice(0, 2))
    expect(first.nextCursor).toEqual({ submittedAt, id: expected[1] })

    const second = await repository.listResponses({
      formId: paginationFormId,
      cursor: first.nextCursor!,
      limit: 2,
    })
    expect(second.items.map(({ id }) => id)).toEqual(expected.slice(2, 4))
    expect(second.nextCursor).toEqual({ submittedAt, id: expected[3] })

    const third = await repository.listResponses({
      formId: paginationFormId,
      cursor: second.nextCursor!,
      limit: 2,
    })
    expect(third.items.map(({ id }) => id)).toEqual(expected.slice(4))
    expect(third.nextCursor).toBeNull()

    const traversed = [...first.items, ...second.items, ...third.items].map(({ id }) => id)
    expect(traversed).toEqual(expected)
    expect(new Set(traversed).size).toBe(5)
  })

  it('serializes full locked revalidation and returns one controlled final-slot rejection', async () => {
    const createdForm = await prisma.databaseForm.create({
      data: {
        sourceId,
        routeKey: `anf_it_${RUN}_final_slot`,
        draftSchema: documentFor(),
        createdById: userId,
        state: 'OPEN',
        responseLimit: 1,
      },
    })
    const version = await prisma.databaseFormVersion.create({
      data: {
        formId: createdForm.id,
        versionNumber: 1,
        schema: documentFor(),
        schemaHash: 'd'.repeat(64),
        publishedById: userId,
        publishedAt: submittedAt,
      },
    })
    const form = await prisma.databaseForm.update({
      where: { id: createdForm.id },
      data: { publishedVersionId: version.id },
    })
    const firstUow = new PrismaUnitOfWork(prisma)
    const secondUow = new PrismaUnitOfWork(prisma)
    const firstRepo = new DatabaseFormRepository(firstUow)
    const secondRepo = new DatabaseFormRepository(secondUow)
    const reservation = {
      formId: form.id,
      now: submittedAt,
      expectedLinkRevision: form.linkRevision,
      expectedAudience: form.audience,
    }
    const admit = (uow: PrismaUnitOfWork, repo: DatabaseFormRepository) =>
      uow.transaction(async () => {
        const locked = await repo.lockSubmissionContext({
          formId: form.id,
          workspaceId,
          pageId: sourcePageId,
          sourceId,
          collectionIds: [],
          parentPageIds: [],
          actorUserId: null,
        })
        if (!locked) throw new Error('FORM_NOT_ACCEPTING')
        const reloaded = await repo.findByLocator(form.routeKey)
        const reloadedVersion = await repo.findVersion(form.id, version.versionNumber)
        if (
          reloaded === null ||
          reloaded.publishedVersionId !== version.id ||
          reloadedVersion?.schemaHash !== version.schemaHash
        ) {
          throw new Error('FORM_NOT_ACCEPTING')
        }
        if (!(await repo.reserveResponseSlot(reservation))) {
          throw new Error('FORM_NOT_ACCEPTING')
        }
        return true
      })

    const results = await Promise.allSettled([
      admit(firstUow, firstRepo),
      admit(secondUow, secondRepo),
    ])

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(({ status }) => status === 'rejected')
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ message: 'FORM_NOT_ACCEPTING' }),
    })
    await expect(
      prisma.databaseForm.findUniqueOrThrow({ where: { id: form.id } }),
    ).resolves.toMatchObject({ acceptedResponses: 1 })
  })

  it('serializes policy disablement before submission revalidation without deadlock', async () => {
    const form = await prisma.databaseForm.create({
      data: {
        sourceId,
        routeKey: `anf_it_${RUN}_policy_race`,
        draftSchema: documentFor(),
        createdById: userId,
        state: 'OPEN',
      },
    })
    const writerUow = new PrismaUnitOfWork(prisma)
    const submitUow = new PrismaUnitOfWork(prisma)
    const submitRepo = new DatabaseFormRepository(submitUow)
    const entered = deferred()
    const release = deferred()
    const writer = writerUow.transaction(async () => {
      expect(await lockWorkspaceForMutation(writerUow.client(), workspaceId)).toBe(true)
      await writerUow.client().workspaceSecurityPolicy.upsert({
        where: { workspaceId },
        create: { workspaceId, configuredById: userId, disablePublicLinksSitesForms: true },
        update: { configuredById: userId, disablePublicLinksSitesForms: true },
      })
      entered.resolve()
      await release.promise
    })
    await entered.promise

    const submission = submitUow.transaction(async () => {
      const locked = await submitRepo.lockSubmissionContext({
        formId: form.id,
        workspaceId,
        pageId: sourcePageId,
        sourceId,
        collectionIds: [],
        parentPageIds: [],
        actorUserId: null,
      })
      if (!locked) throw new Error('FORM_NOT_ACCEPTING')
      const policy = await submitUow.client().workspaceSecurityPolicy.findUnique({
        where: { workspaceId },
      })
      if (policy?.disablePublicLinksSitesForms === true) throw new Error('FORM_NOT_ACCEPTING')
      return true
    })
    release.resolve()

    await settlesWithin(writer)
    await expect(settlesWithin(submission)).rejects.toThrow('FORM_NOT_ACCEPTING')
  })

  it('serializes member removal before submission revalidation without deadlock', async () => {
    const target = await prisma.user.create({
      data: {
        name: `Member race ${RUN}`,
        firstName: 'Member',
        lastName: 'Race',
        email: `database-form-repository-${RUN}-member@example.test`,
      },
    })
    await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId, userId } },
      create: { workspaceId, userId, role: 'OWNER' },
      update: { role: 'OWNER' },
    })
    await prisma.workspaceMember.create({
      data: { workspaceId, userId: target.id, role: 'EDITOR' },
    })
    const form = await prisma.databaseForm.create({
      data: {
        sourceId,
        routeKey: `anf_it_${RUN}_member_race`,
        draftSchema: documentFor(),
        createdById: userId,
        state: 'OPEN',
        audience: 'WORKSPACE_MEMBERS_WITH_LINK',
      },
    })
    const writerUow = new PrismaUnitOfWork(prisma)
    const submitUow = new PrismaUnitOfWork(prisma)
    const submitRepo = new DatabaseFormRepository(submitUow)
    const entered = deferred()
    const release = deferred()
    class PausingPeopleRepository extends PeopleRepository {
      override async deleteMember(workspace: string, member: string): Promise<void> {
        await super.deleteMember(workspace, member)
        entered.resolve()
        await release.promise
      }
    }
    const writerService = new PeopleService(
      new PausingPeopleRepository(writerUow),
      writerUow,
      {} as CollectionService,
      {} as BillingService,
    )
    const writer = writerService.removeMember({
      workspaceId,
      actorId: userId,
      actorRole: 'OWNER',
      userId: target.id,
    })
    await entered.promise

    const submission = submitUow.transaction(async () => {
      const locked = await submitRepo.lockSubmissionContext({
        formId: form.id,
        workspaceId,
        pageId: sourcePageId,
        sourceId,
        collectionIds: [],
        parentPageIds: [],
        actorUserId: target.id,
      })
      if (!locked) throw new Error('FORM_NOT_ACCEPTING')
      const member = await submitUow.client().workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: target.id } },
      })
      if (member === null) throw new Error('FORM_NOT_ACCEPTING')
      return true
    })
    release.resolve()

    await settlesWithin(writer)
    await expect(settlesWithin(submission)).rejects.toThrow('FORM_NOT_ACCEPTING')
  })

  it('serializes an audited audience change before submission revalidation without deadlock', async () => {
    await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId, userId } },
      create: { workspaceId, userId, role: 'OWNER' },
      update: { role: 'OWNER' },
    })
    const form = await prisma.databaseForm.create({
      data: {
        sourceId,
        routeKey: `anf_it_${RUN}_audience_race`,
        draftSchema: documentFor(),
        createdById: userId,
        state: 'OPEN',
        audience: 'ANYONE_WITH_LINK',
      },
    })
    const writerUow = new PrismaUnitOfWork(prisma)
    const submitUow = new PrismaUnitOfWork(prisma)
    const entered = deferred()
    const release = deferred()
    class PausingFormRepository extends DatabaseFormRepository {
      override async updateSettings(
        input: Parameters<DatabaseFormRepository['updateSettings']>[0],
      ) {
        const updated = await super.updateSettings(input)
        entered.resolve()
        await release.promise
        return updated
      }
    }
    const writerService = new DatabaseFormService(
      new PausingFormRepository(writerUow),
      new DatabaseRepository(writerUow),
      writerUow,
      {} as BillingService,
    )
    const submitRepo = new DatabaseFormRepository(submitUow)
    const writer = writerService.updateSettings(userId, {
      pageId: sourcePageId,
      formId: form.id,
      audience: 'SIGNED_IN_WITH_LINK',
      respondentAccess: 'NONE',
      opensAt: null,
      closesAt: null,
      responseLimit: null,
      notifyOwners: false,
    })
    await entered.promise

    const submission = submitUow.transaction(async () => {
      const locked = await submitRepo.lockSubmissionContext({
        formId: form.id,
        workspaceId,
        pageId: sourcePageId,
        sourceId,
        collectionIds: [],
        parentPageIds: [],
        actorUserId: null,
      })
      if (!locked) throw new Error('FORM_NOT_ACCEPTING')
      const reloaded = await submitRepo.findByLocator(form.routeKey)
      if (reloaded?.audience !== 'ANYONE_WITH_LINK') throw new Error('FORM_NOT_ACCEPTING')
      return true
    })
    release.resolve()

    await settlesWithin(writer)
    await expect(settlesWithin(submission)).rejects.toThrow('FORM_NOT_ACCEPTING')
  })

  it('persists prepared server values once and replays without another slot, page, or outbox', async () => {
    await prisma.workspaceSecurityPolicy.updateMany({
      where: { workspaceId },
      data: { disablePublicLinksSitesForms: false },
    })
    const property = await prisma.databaseProperty.create({
      data: { sourceId, type: 'TEXT', name: `Replay ${RUN}`, position: 9_998 },
    })
    const form = await prisma.databaseForm.create({
      data: {
        sourceId,
        routeKey: `anf_it_${RUN}_replay`,
        draftSchema: documentFor(property.id),
        createdById: userId,
        state: 'OPEN',
        responseLimit: 1,
      },
    })
    const version = await prisma.databaseFormVersion.create({
      data: {
        formId: form.id,
        versionNumber: 1,
        schema: documentFor(property.id),
        schemaHash: 'f'.repeat(64),
        publishedById: userId,
        publishedAt: submittedAt,
      },
    })
    await prisma.databaseForm.update({
      where: { id: form.id },
      data: { publishedVersionId: version.id },
    })
    const uow = new PrismaUnitOfWork(prisma)
    const service = productionSubmissionService(uow)
    const idempotencyKey = randomUUID()
    const request = productionSubmissionInput(
      form.routeKey,
      idempotencyKey,
      'Server-prepared value',
    )
    request.token.schemaHash = version.schemaHash
    request.token.linkRevision = form.linkRevision
    const pagesBefore = await prisma.page.count({ where: { parentId: sourcePageId } })
    const outboxBefore = await prisma.outboxEvent.count({ where: { workspaceId } })

    const first = await service.submit(null, request.input, request.token)
    const outboxAfterFirst = await prisma.outboxEvent.count({ where: { workspaceId } })
    const replay = await service.submit(null, request.input, request.token)

    expect(first.created).toBe(true)
    expect(replay).toEqual({ ...first, created: false })
    await expect(
      prisma.databaseForm.findUniqueOrThrow({ where: { id: form.id } }),
    ).resolves.toMatchObject({ acceptedResponses: 1 })
    await expect(prisma.page.count({ where: { parentId: sourcePageId } })).resolves.toBe(
      pagesBefore + 1,
    )
    await expect(prisma.databaseFormSubmission.count({ where: { formId: form.id } })).resolves.toBe(
      1,
    )
    expect(outboxAfterFirst).toBe(outboxBefore + 2)
    await expect(prisma.outboxEvent.count({ where: { workspaceId } })).resolves.toBe(
      outboxAfterFirst,
    )
    await expect(
      prisma.databaseFormSubmission.findUniqueOrThrow({
        where: { formId_idempotencyKey: { formId: form.id, idempotencyKey } },
        include: { row: { include: { page: true, cells: true } } },
      }),
    ).resolves.toMatchObject({
      endingId: 'ending-1',
      respondentUserId: null,
      row: {
        createdById: null,
        page: { createdById: null },
        cells: [{ propertyId: property.id, value: 'Server-prepared value' }],
      },
    })
  })

  it('converges simultaneous same-idempotency submissions to one committed response', async () => {
    const property = await prisma.databaseProperty.create({
      data: { sourceId, type: 'TEXT', name: `Concurrent replay ${RUN}`, position: 9_997 },
    })
    const form = await prisma.databaseForm.create({
      data: {
        sourceId,
        routeKey: `anf_it_${RUN}_concurrent_replay`,
        draftSchema: documentFor(property.id),
        createdById: userId,
        state: 'OPEN',
        responseLimit: 1,
      },
    })
    const version = await prisma.databaseFormVersion.create({
      data: {
        formId: form.id,
        versionNumber: 1,
        schema: documentFor(property.id),
        schemaHash: '7'.repeat(64),
        publishedById: userId,
        publishedAt: submittedAt,
      },
    })
    await prisma.databaseForm.update({
      where: { id: form.id },
      data: { publishedVersionId: version.id },
    })
    const idempotencyKey = randomUUID()
    const request = productionSubmissionInput(form.routeKey, idempotencyKey, 'same response')
    request.token.schemaHash = version.schemaHash
    request.token.linkRevision = form.linkRevision
    const pagesBefore = await prisma.page.count({ where: { parentId: sourcePageId } })
    const outboxBefore = await prisma.outboxEvent.count({ where: { workspaceId } })
    const makeService = () => {
      const uow = new PrismaUnitOfWork(prisma)
      return productionSubmissionService(uow)
    }

    const [first, second] = await Promise.all([
      makeService().submit(null, request.input, request.token),
      makeService().submit(null, request.input, request.token),
    ])

    expect([first.created, second.created].sort()).toEqual([false, true])
    expect(first.submissionId).toBe(second.submissionId)
    await expect(
      prisma.databaseForm.findUniqueOrThrow({ where: { id: form.id } }),
    ).resolves.toMatchObject({ acceptedResponses: 1 })
    await expect(prisma.page.count({ where: { parentId: sourcePageId } })).resolves.toBe(
      pagesBefore + 1,
    )
    await expect(prisma.databaseFormSubmission.count({ where: { formId: form.id } })).resolves.toBe(
      1,
    )
    await expect(prisma.outboxEvent.count({ where: { workspaceId } })).resolves.toBe(
      outboxBefore + 2,
    )
  })

  it('holds row, page, and access-rule authorities through locked revalidation and commit', async () => {
    await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId, userId } },
      create: { workspaceId, userId, role: 'OWNER' },
      update: { role: 'OWNER' },
    })
    const targetSourcePage = await prisma.page.create({
      data: {
        workspaceId,
        type: PageType.DATABASE,
        title: `Authority target ${RUN}`,
        createdById: userId,
      },
    })
    const targetSource = await prisma.databaseSource.create({
      data: { workspaceId, pageId: targetSourcePage.id, title: `Authority target ${RUN}` },
    })
    const aclProperty = await prisma.databaseProperty.create({
      data: {
        sourceId: targetSource.id,
        type: 'CREATED_BY',
        name: `Authority creator ${RUN}`,
        position: 0,
      },
    })
    const rule = await prisma.databasePageAccessRule.create({
      data: {
        sourceId: targetSource.id,
        propertyId: aclProperty.id,
        accessLevel: 'FULL_ACCESS',
      },
    })
    const targetPage = await prisma.page.create({
      data: {
        workspaceId,
        parentId: targetSourcePage.id,
        title: `Authority row ${RUN}`,
        createdById: userId,
      },
    })
    const targetRow = await prisma.databaseRow.create({
      data: {
        sourceId: targetSource.id,
        pageId: targetPage.id,
        createdById: userId,
        updatedById: userId,
      },
    })
    const relationProperty = await prisma.databaseProperty.create({
      data: {
        sourceId,
        type: 'RELATION',
        name: `Authority relation ${RUN}`,
        position: 9_995,
        settings: { relation: { targetSourceId: targetSource.id } },
      },
    })
    const schema = relationDocumentFor(relationProperty.id)
    const form = await prisma.databaseForm.create({
      data: {
        sourceId,
        routeKey: `anf_it_${RUN}_authority_race`,
        draftSchema: schema,
        createdById: userId,
        state: 'OPEN',
        audience: 'WORKSPACE_MEMBERS_WITH_LINK',
      },
    })
    const version = await prisma.databaseFormVersion.create({
      data: {
        formId: form.id,
        versionNumber: 1,
        schema,
        schemaHash: 'a'.repeat(64),
        publishedById: userId,
        publishedAt: submittedAt,
      },
    })
    await prisma.databaseForm.update({
      where: { id: form.id },
      data: { publishedVersionId: version.id },
    })

    const authoritiesLocked = deferred()
    const releaseSubmission = deferred()
    const submitUow = new PrismaUnitOfWork(prisma)
    class PausingAuthorityFormRepository extends DatabaseFormRepository {
      override async lockFormSubmissionAuthorities(
        input: LockFormSubmissionAuthoritiesRecord,
      ): Promise<boolean> {
        const locked = await super.lockFormSubmissionAuthorities(input)
        authoritiesLocked.resolve()
        await releaseSubmission.promise
        return locked
      }
    }
    const service = productionSubmissionService(
      submitUow,
      new PausingAuthorityFormRepository(submitUow),
    )
    const request = productionSubmissionInput(form.routeKey, randomUUID(), [targetRow.id])
    request.token.schemaHash = version.schemaHash
    request.token.linkRevision = form.linkRevision
    const submission = service.submit(userId, request.input, request.token)
    await authoritiesLocked.promise

    const rowWriter = prisma.databaseRow.update({
      where: { id: targetRow.id },
      data: { deletedAt: new Date('2026-07-16T01:00:00.000Z') },
    })
    const pageWriter = prisma.page.update({
      where: { id: targetPage.id },
      data: { archivedAt: new Date('2026-07-16T01:00:00.000Z') },
    })
    const ruleWriter = prisma.databasePageAccessRule.update({
      where: { id: rule.id },
      data: { accessLevel: 'CAN_VIEW' },
    })
    const writerState = Promise.all([rowWriter, pageWriter, ruleWriter]).then(() => 'committed')
    await expect(
      Promise.race([
        writerState,
        new Promise<'waiting'>((resolve) => setTimeout(() => resolve('waiting'), 100)),
      ]),
    ).resolves.toBe('waiting')

    releaseSubmission.resolve()
    await expect(settlesWithin(submission)).resolves.toMatchObject({ created: true })
    await expect(settlesWithin(writerState)).resolves.toBe('committed')
    await expect(prisma.databaseFormSubmission.count({ where: { formId: form.id } })).resolves.toBe(
      1,
    )
  })

  it('does not deadlock when a hard target-page delete owns the FK parent first', async () => {
    await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId, userId } },
      create: { workspaceId, userId, role: 'OWNER' },
      update: { role: 'OWNER' },
    })
    const targetSourcePage = await prisma.page.create({
      data: {
        workspaceId,
        type: PageType.DATABASE,
        title: `Hard-delete target ${RUN}`,
        createdById: userId,
      },
    })
    const targetSource = await prisma.databaseSource.create({
      data: { workspaceId, pageId: targetSourcePage.id, title: `Hard-delete target ${RUN}` },
    })
    const targetPage = await prisma.page.create({
      data: {
        workspaceId,
        parentId: targetSourcePage.id,
        title: `Hard-delete row ${RUN}`,
        createdById: userId,
      },
    })
    const targetRow = await prisma.databaseRow.create({
      data: {
        sourceId: targetSource.id,
        pageId: targetPage.id,
        createdById: userId,
        updatedById: userId,
      },
    })
    const relationProperty = await prisma.databaseProperty.create({
      data: {
        sourceId,
        type: 'RELATION',
        name: `Hard-delete relation ${RUN}`,
        position: 9_994,
        settings: { relation: { targetSourceId: targetSource.id } },
      },
    })
    const schema = relationDocumentFor(relationProperty.id)
    const form = await prisma.databaseForm.create({
      data: {
        sourceId,
        routeKey: `anf_it_${RUN}_hard_page_race`,
        draftSchema: schema,
        createdById: userId,
        state: 'OPEN',
        audience: 'WORKSPACE_MEMBERS_WITH_LINK',
      },
    })
    const version = await prisma.databaseFormVersion.create({
      data: {
        formId: form.id,
        versionNumber: 1,
        schema,
        schemaHash: 'b'.repeat(64),
        publishedById: userId,
        publishedAt: submittedAt,
      },
    })
    await prisma.databaseForm.update({
      where: { id: form.id },
      data: { publishedVersionId: version.id },
    })

    const parentHeld = deferred()
    const allowDelete = deferred()
    const writerUow = new PrismaUnitOfWork(prisma)
    const writer = writerUow.transaction(async () => {
      await writerUow.client().$queryRaw`
        SELECT id FROM pages WHERE id = ${targetSourcePage.id}::uuid FOR UPDATE
      `
      parentHeld.resolve()
      await allowDelete.promise
      await writerUow.client().page.delete({ where: { id: targetSourcePage.id } })
    })
    await parentHeld.promise

    const parentAttempted = deferred()
    const submitUow = new QueryObservingUnitOfWork((sql) => {
      if (sql.includes('FROM pages') && sql.includes('WHERE id IN') && sql.includes('FOR UPDATE')) {
        parentAttempted.resolve()
      }
    })
    const request = productionSubmissionInput(form.routeKey, randomUUID(), [targetRow.id])
    request.token.schemaHash = version.schemaHash
    request.token.linkRevision = form.linkRevision
    const submission = productionSubmissionService(submitUow).submit(
      userId,
      request.input,
      request.token,
    )
    await settlesWithin(parentAttempted.promise)
    allowDelete.resolve()

    const outcomes = await settlesWithin(Promise.allSettled([submission, writer]))
    expect(outcomes.map((outcome) => outcome.status)).toContain('fulfilled')
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') expect(errorDetails(outcome.reason)).not.toContain('40P01')
    }
    await expect(
      prisma.databaseFormSubmission.count({ where: { formId: form.id } }),
    ).resolves.toBeLessThanOrEqual(1)
  })

  it('does not deadlock when a row soft-delete overlaps a relation submission', async () => {
    await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId, userId } },
      create: { workspaceId, userId, role: 'OWNER' },
      update: { role: 'OWNER' },
    })
    const targetPage = await prisma.page.create({
      data: { workspaceId, parentId: sourcePageId, title: `Soft-delete target ${RUN}`, createdById: userId },
    })
    const targetRow = await prisma.databaseRow.create({
      data: { sourceId, pageId: targetPage.id, createdById: userId, updatedById: userId },
    })
    const relationProperty = await prisma.databaseProperty.create({
      data: {
        sourceId,
        type: 'RELATION',
        name: `Soft-delete relation ${RUN}`,
        position: 9_992,
        settings: { relation: { targetSourceId: sourceId } },
      },
    })
    const form = await prisma.databaseForm.create({
      data: {
        sourceId,
        routeKey: `anf_it_${RUN}_soft_delete_race`,
        draftSchema: relationDocumentFor(relationProperty.id),
        createdById: userId,
        state: 'OPEN',
        audience: 'WORKSPACE_MEMBERS_WITH_LINK',
      },
    })

    const rowHeld = deferred()
    const releaseDelete = deferred()
    class PausingDeleteRepository extends DatabaseRepository {
      override async softDeleteRow(rowId: string, updatedById: string): Promise<void> {
        await super.softDeleteRow(rowId, updatedById)
        rowHeld.resolve()
        await releaseDelete.promise
      }
    }
    const deleteUow = new PrismaUnitOfWork(prisma)
    const deletion = new DatabaseService(
      new PausingDeleteRepository(deleteUow),
      {} as never,
      deleteUow,
      {} as never,
      {} as never,
    ).deleteRow(userId, { pageId: sourcePageId, rowId: targetRow.id })
    await rowHeld.promise

    const workspaceAttempted = deferred()
    const allowWorkspaceQuery = deferred()
    const rowAttempted = deferred()
    class PausingSubmissionUnitOfWork implements UnitOfWork {
      private readonly inner = new PrismaUnitOfWork(prisma)

      transaction<T>(fn: () => Promise<T>): Promise<T> {
        return this.inner.transaction(fn)
      }

      client(): Db {
        const client = this.inner.client()
        return new Proxy(client, {
          get: (target, property, receiver) => {
            const value = Reflect.get(target, property, receiver)
            if (property !== '$queryRaw' || typeof value !== 'function') return value
            return async (...args: unknown[]) => {
              const query = args[0]
              const sql =
                query !== null && typeof query === 'object' && 'strings' in query
                  ? (query as { strings: readonly string[] }).strings.join('')
                  : ''
              if (sql.includes('FROM workspaces')) {
                workspaceAttempted.resolve()
                await allowWorkspaceQuery.promise
              }
              if (sql.includes('FROM database_rows') && sql.includes('FOR UPDATE')) {
                rowAttempted.resolve()
              }
              return Reflect.apply(value, target, args)
            }
          },
        }) as Db
      }
    }

    const submitUow = new PausingSubmissionUnitOfWork()
    const submitRepo = new DatabaseFormRepository(submitUow)
    const submission = submitUow.transaction(async () => {
      expect(
        await submitRepo.lockSubmissionContext({
          formId: form.id,
          workspaceId,
          pageId: sourcePageId,
          sourceId,
          collectionIds: [],
          parentPageIds: [],
          actorUserId: userId,
        }),
      ).toBe(true)
      expect(
        await submitRepo.lockFormSubmissionAuthorities({
          formId: form.id,
          workspaceId,
          formSourceId: sourceId,
          actorUserId: userId,
          personUserIds: [],
          sourceIds: [sourceId],
          propertyIds: [relationProperty.id],
          rowIds: [targetRow.id],
          collectionIds: [],
          parentPageIds: [],
          pageIds: [targetPage.id],
          uploadIds: [],
          fileIds: [],
        }),
      ).toBe(true)
    })
    await workspaceAttempted.promise

    // The submission is paused before taking workspace. NOWAIT distinguishes
    // the fixed writer (workspace already held) from the old row-first writer
    // without timing assumptions, so the RED path still reaches the real cycle.
    let deleteOwnsWorkspace = false
    try {
      await prisma.$transaction((tx) => tx.$queryRaw`
        SELECT id FROM workspaces WHERE id = ${workspaceId}::uuid FOR UPDATE NOWAIT
      `)
    } catch (reason) {
      expect(errorDetails(reason)).toContain('55P03')
      deleteOwnsWorkspace = true
    }
    if (deleteOwnsWorkspace) releaseDelete.resolve()
    allowWorkspaceQuery.resolve()
    if (!deleteOwnsWorkspace) {
      await rowAttempted.promise
      releaseDelete.resolve()
    }

    const outcomes = await settlesWithin(Promise.allSettled([submission, deletion]))
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') expect(errorDetails(outcome.reason)).not.toContain('40P01')
    }
    expect(outcomes[1]?.status).toBe('fulfilled')
    await expect(prisma.databaseRow.findUniqueOrThrow({ where: { id: targetRow.id } })).resolves.toMatchObject({
      deletedAt: expect.any(Date),
    })
  })

  it('does not deadlock when a hard file delete owns the FK parent first', async () => {
    const property = await prisma.databaseProperty.create({
      data: { sourceId, type: 'FILE', name: `Hard-delete upload ${RUN}`, position: 9_993 },
    })
    const schema = fileDocumentFor(property.id)
    const form = await prisma.databaseForm.create({
      data: {
        sourceId,
        routeKey: `anf_it_${RUN}_hard_file_race`,
        draftSchema: schema,
        createdById: userId,
        state: 'OPEN',
      },
    })
    const version = await prisma.databaseFormVersion.create({
      data: {
        formId: form.id,
        versionNumber: 1,
        schema,
        schemaHash: 'c'.repeat(64),
        publishedById: userId,
        publishedAt: submittedAt,
      },
    })
    await prisma.databaseForm.update({
      where: { id: form.id },
      data: { publishedVersionId: version.id },
    })
    const file = await prisma.file.create({
      data: {
        userId,
        workspaceId,
        name: `hard-delete-${RUN}.txt`,
        ext: 'txt',
        fileSize: 128n,
        mimeType: 'text/plain',
        hash: 'd'.repeat(64),
        path: `forms/${RUN}/hard-delete.txt`,
        status: 'PENDING',
        expiresAt: new Date('2026-07-17T00:00:00.000Z'),
      },
    })
    const leaseToken = `hard-delete-${randomUUID()}`
    await prisma.databaseFormUpload.create({
      data: {
        formId: form.id,
        versionId: version.id,
        questionId: 'question-1',
        fileId: file.id,
        uploadTokenHash: createHash('sha256').update(leaseToken).digest('hex'),
        expiresAt: new Date('2026-07-17T00:00:00.000Z'),
      },
    })

    const parentHeld = deferred()
    const allowDelete = deferred()
    const writerUow = new PrismaUnitOfWork(prisma)
    const writer = writerUow.transaction(async () => {
      await writerUow.client().$queryRaw`
        SELECT id FROM files WHERE id = ${file.id}::uuid FOR UPDATE
      `
      parentHeld.resolve()
      await allowDelete.promise
      await writerUow.client().file.delete({ where: { id: file.id } })
    })
    await parentHeld.promise

    const parentAttempted = deferred()
    const submitUow = new QueryObservingUnitOfWork((sql) => {
      if (sql.includes('FROM files') && sql.includes('FOR UPDATE')) parentAttempted.resolve()
    })
    const request = productionSubmissionInput(form.routeKey, randomUUID(), [leaseToken])
    request.token.schemaHash = version.schemaHash
    request.token.linkRevision = form.linkRevision
    const submission = productionSubmissionService(submitUow).submit(
      null,
      request.input,
      request.token,
    )
    await settlesWithin(parentAttempted.promise)
    allowDelete.resolve()

    const outcomes = await settlesWithin(Promise.allSettled([submission, writer]))
    expect(outcomes.map((outcome) => outcome.status)).toContain('fulfilled')
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') expect(errorDetails(outcome.reason)).not.toContain('40P01')
    }
    await expect(
      prisma.databaseFormSubmission.count({ where: { formId: form.id } }),
    ).resolves.toBeLessThanOrEqual(1)
  })

  it('attaches and activates a leased file atomically, then rolls back a second claim', async () => {
    const property = await prisma.databaseProperty.create({
      data: { sourceId, type: 'FILE', name: `Upload ${RUN}`, position: 9_996 },
    })
    const form = await prisma.databaseForm.create({
      data: {
        sourceId,
        routeKey: `anf_it_${RUN}_file_consume`,
        draftSchema: fileDocumentFor(property.id),
        createdById: userId,
        state: 'OPEN',
        responseLimit: 2,
      },
    })
    const version = await prisma.databaseFormVersion.create({
      data: {
        formId: form.id,
        versionNumber: 1,
        schema: fileDocumentFor(property.id),
        schemaHash: '8'.repeat(64),
        publishedById: userId,
        publishedAt: submittedAt,
      },
    })
    await prisma.databaseForm.update({
      where: { id: form.id },
      data: { publishedVersionId: version.id },
    })
    const file = await prisma.file.create({
      data: {
        userId,
        workspaceId,
        name: `form-${RUN}.txt`,
        ext: 'txt',
        fileSize: 128n,
        mimeType: 'text/plain',
        hash: '9'.repeat(64),
        path: `forms/${RUN}/file.txt`,
        status: 'PENDING',
        expiresAt: new Date('2026-07-17T00:00:00.000Z'),
      },
    })
    const leaseToken = `lease-${randomUUID()}`
    const tokenHash = createHash('sha256').update(leaseToken).digest('hex')
    await prisma.databaseFormUpload.create({
      data: {
        formId: form.id,
        versionId: version.id,
        questionId: 'question-1',
        fileId: file.id,
        uploadTokenHash: tokenHash,
        expiresAt: new Date('2026-07-17T00:00:00.000Z'),
      },
    })
    const uow = new PrismaUnitOfWork(prisma)
    const formRepo = new DatabaseFormRepository(uow)
    const service = productionSubmissionService(uow, formRepo)
    const request = productionSubmissionInput(form.routeKey, randomUUID(), [leaseToken])
    request.token.schemaHash = version.schemaHash
    request.token.linkRevision = form.linkRevision
    const pagesBefore = await prisma.page.count({ where: { parentId: sourcePageId } })
    const first = await service.submit(null, request.input, request.token)
    const persisted = await prisma.databaseFormSubmission.findUniqueOrThrow({
      where: { id: first.submissionId },
      select: { rowId: true, row: { select: { pageId: true } } },
    })

    await expect(
      prisma.databaseFormUpload.findUniqueOrThrow({ where: { fileId: file.id } }),
    ).resolves.toMatchObject({ consumedAt: submittedAt })
    await expect(prisma.file.findUniqueOrThrow({ where: { id: file.id } })).resolves.toMatchObject({
      status: 'ACTIVE',
      expiresAt: null,
    })
    await expect(
      prisma.pageFile.findUniqueOrThrow({
        where: { pageId_fileId: { pageId: persisted.row.pageId, fileId: file.id } },
      }),
    ).resolves.toMatchObject({ pageId: persisted.row.pageId, fileId: file.id })
    await expect(
      prisma.databaseCellValue.findUniqueOrThrow({
        where: { rowId_propertyId: { rowId: persisted.rowId, propertyId: property.id } },
      }),
    ).resolves.toMatchObject({ value: [file.id] })

    await expect(
      service.submit(null, { ...request.input, idempotencyKey: randomUUID() }, request.token),
    ).rejects.toMatchObject({ message: 'FORM_ANSWERS_INVALID' })
    await expect(
      prisma.databaseForm.findUniqueOrThrow({ where: { id: form.id } }),
    ).resolves.toMatchObject({ acceptedResponses: 1 })
    await expect(prisma.page.count({ where: { parentId: sourcePageId } })).resolves.toBe(
      pagesBefore + 1,
    )
    await expect(prisma.databaseFormSubmission.count({ where: { formId: form.id } })).resolves.toBe(
      1,
    )
  })

  it('rolls back the slot, page, row, value, submission, and outbox when the final write fails', async () => {
    const property = await prisma.databaseProperty.create({
      data: { sourceId, type: 'TEXT', name: `Rollback ${RUN}`, position: 9_999 },
    })
    const form = await prisma.databaseForm.create({
      data: {
        sourceId,
        routeKey: `anf_it_${RUN}_rollback`,
        draftSchema: documentFor(property.id),
        createdById: userId,
        state: 'OPEN',
        responseLimit: 1,
      },
    })
    const version = await prisma.databaseFormVersion.create({
      data: {
        formId: form.id,
        versionNumber: 1,
        schema: documentFor(property.id),
        schemaHash: 'e'.repeat(64),
        publishedById: userId,
        publishedAt: submittedAt,
      },
    })
    await prisma.databaseForm.update({
      where: { id: form.id },
      data: { publishedVersionId: version.id },
    })
    const before = {
      pages: await prisma.page.count({ where: { parentId: sourcePageId } }),
      rows: await prisma.databaseRow.count({ where: { sourceId } }),
      values: await prisma.databaseCellValue.count({ where: { propertyId: property.id } }),
      submissions: await prisma.databaseFormSubmission.count({ where: { formId: form.id } }),
      outbox: await prisma.outboxEvent.count({ where: { workspaceId } }),
    }
    const uow = new PrismaUnitOfWork(prisma)
    const service = productionSubmissionService(uow, new FailingOutboxFormRepository(uow))
    const request = productionSubmissionInput(form.routeKey, randomUUID(), 'Must roll back')
    request.token.schemaHash = version.schemaHash
    request.token.linkRevision = form.linkRevision

    await expect(service.submit(null, request.input, request.token)).rejects.toThrow(
      'TEST_OUTBOX_FAILURE',
    )

    await expect(
      prisma.databaseForm.findUniqueOrThrow({ where: { id: form.id } }),
    ).resolves.toMatchObject({ acceptedResponses: 0 })
    await expect(prisma.page.count({ where: { parentId: sourcePageId } })).resolves.toBe(
      before.pages,
    )
    await expect(prisma.databaseRow.count({ where: { sourceId } })).resolves.toBe(before.rows)
    await expect(
      prisma.databaseCellValue.count({ where: { propertyId: property.id } }),
    ).resolves.toBe(before.values)
    await expect(prisma.databaseFormSubmission.count({ where: { formId: form.id } })).resolves.toBe(
      before.submissions,
    )
    await expect(prisma.outboxEvent.count({ where: { workspaceId } })).resolves.toBe(before.outbox)
  })
})
