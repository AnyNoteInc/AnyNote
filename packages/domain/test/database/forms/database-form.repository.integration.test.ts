import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PageType, prisma } from '@repo/db'

import { PrismaUnitOfWork } from '../../../src/shared/unit-of-work.ts'
import { lockWorkspaceForMutation } from '../../../src/shared/workspace-transaction-lock.ts'
import {
  DatabaseFormRepository,
  type EnqueueFormSubmittedEventRecord,
} from '../../../src/database/forms/database-form.repository.ts'
import { FormSubmissionService } from '../../../src/database/forms/form-submission.service.ts'
import { DatabaseRepository } from '../../../src/database/repositories/database.repository.ts'
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
        responseLimit: 2,
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
    const service = new FormSubmissionService(
      new DatabaseFormRepository(uow),
      new DatabaseRepository(uow),
      new PageRepository(uow),
      uow,
    )
    const idempotencyKey = randomUUID()
    const input = {
      formId: form.id,
      linkRevision: form.linkRevision,
      audience: form.audience,
      versionId: version.id,
      versionNumber: 1,
      sourceId,
      sourcePageId,
      workspaceId,
      respondentUserId: userId,
      idempotencyKey,
      endingId: 'server-ending',
      title: 'Server-prepared title',
      scalarValues: [{ propertyId: property.id, value: 'Server-prepared value' }],
      relationValues: [],
      fileValues: [],
      submittedAt,
    }
    const pagesBefore = await prisma.page.count({ where: { parentId: sourcePageId } })
    const outboxBefore = await prisma.outboxEvent.count({ where: { workspaceId } })

    const first = await service.persistPrepared(input)
    const outboxAfterFirst = await prisma.outboxEvent.count({ where: { workspaceId } })
    const replay = await service.persistPrepared(input)

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
      endingId: 'server-ending',
      respondentUserId: userId,
      row: {
        createdById: userId,
        page: { title: 'Server-prepared title', createdById: userId },
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
        responseLimit: 2,
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
    const prepared = {
      formId: form.id,
      linkRevision: form.linkRevision,
      audience: form.audience,
      versionId: version.id,
      versionNumber: 1,
      sourceId,
      sourcePageId,
      workspaceId,
      respondentUserId: userId,
      idempotencyKey,
      endingId: 'server-ending',
      title: 'Concurrent replay',
      scalarValues: [{ propertyId: property.id, value: 'same response' }],
      relationValues: [],
      fileValues: [],
      submittedAt,
    }
    const pagesBefore = await prisma.page.count({ where: { parentId: sourcePageId } })
    const outboxBefore = await prisma.outboxEvent.count({ where: { workspaceId } })
    const makeService = () => {
      const uow = new PrismaUnitOfWork(prisma)
      return new FormSubmissionService(
        new DatabaseFormRepository(uow),
        new DatabaseRepository(uow),
        new PageRepository(uow),
        uow,
      )
    }

    const [first, second] = await Promise.all([
      makeService().persistPrepared(prepared),
      makeService().persistPrepared(prepared),
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

  it('attaches and activates a leased file atomically, then rolls back a second claim', async () => {
    const property = await prisma.databaseProperty.create({
      data: { sourceId, type: 'FILE', name: `Upload ${RUN}`, position: 9_996 },
    })
    const form = await prisma.databaseForm.create({
      data: {
        sourceId,
        routeKey: `anf_it_${RUN}_file_consume`,
        draftSchema: documentFor(property.id),
        createdById: userId,
        state: 'OPEN',
        responseLimit: 2,
      },
    })
    const version = await prisma.databaseFormVersion.create({
      data: {
        formId: form.id,
        versionNumber: 1,
        schema: documentFor(property.id),
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
    const tokenHash = 'a'.repeat(64)
    await prisma.databaseFormUpload.create({
      data: {
        formId: form.id,
        versionId: version.id,
        questionId: 'files',
        fileId: file.id,
        uploadTokenHash: tokenHash,
        expiresAt: new Date('2026-07-17T00:00:00.000Z'),
      },
    })
    const uow = new PrismaUnitOfWork(prisma)
    const formRepo = new DatabaseFormRepository(uow)
    const service = new FormSubmissionService(
      formRepo,
      new DatabaseRepository(uow),
      new PageRepository(uow),
      uow,
    )
    const uploads = await formRepo.resolveUploadLeases({
      formId: form.id,
      versionId: version.id,
      questionId: 'files',
      tokenHashes: [tokenHash],
      now: submittedAt,
    })
    const pagesBefore = await prisma.page.count({ where: { parentId: sourcePageId } })
    const base = {
      formId: form.id,
      linkRevision: form.linkRevision,
      audience: form.audience,
      versionId: version.id,
      versionNumber: 1,
      sourceId,
      sourcePageId,
      workspaceId,
      respondentUserId: userId,
      endingId: 'server-ending',
      title: 'File response',
      scalarValues: [],
      relationValues: [],
      fileValues: [{ propertyId: property.id, questionId: 'files', uploads }],
      submittedAt,
    }

    const first = await service.persistPrepared({ ...base, idempotencyKey: randomUUID() })

    await expect(
      prisma.databaseFormUpload.findUniqueOrThrow({ where: { fileId: file.id } }),
    ).resolves.toMatchObject({ consumedAt: submittedAt })
    await expect(prisma.file.findUniqueOrThrow({ where: { id: file.id } })).resolves.toMatchObject({
      status: 'ACTIVE',
      expiresAt: null,
    })
    await expect(
      prisma.pageFile.findUniqueOrThrow({
        where: { pageId_fileId: { pageId: first.pageId, fileId: file.id } },
      }),
    ).resolves.toMatchObject({ pageId: first.pageId, fileId: file.id })
    await expect(
      prisma.databaseCellValue.findUniqueOrThrow({
        where: { rowId_propertyId: { rowId: first.rowId, propertyId: property.id } },
      }),
    ).resolves.toMatchObject({ value: [file.id] })

    await expect(
      service.persistPrepared({ ...base, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ message: 'FORM_UPLOAD_INVALID' })
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
    const service = new FormSubmissionService(
      new FailingOutboxFormRepository(uow),
      new DatabaseRepository(uow),
      new PageRepository(uow),
      uow,
    )

    await expect(
      service.persistPrepared({
        formId: form.id,
        linkRevision: form.linkRevision,
        audience: form.audience,
        versionId: version.id,
        versionNumber: 1,
        sourceId,
        sourcePageId,
        workspaceId,
        respondentUserId: null,
        idempotencyKey: randomUUID(),
        endingId: 'ending-1',
        title: 'Must roll back',
        scalarValues: [{ propertyId: property.id, value: 'Must roll back' }],
        relationValues: [],
        fileValues: [],
        submittedAt,
      }),
    ).rejects.toThrow('TEST_OUTBOX_FAILURE')

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
