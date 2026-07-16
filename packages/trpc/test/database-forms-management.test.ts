import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CollectionKind, PageType, prisma } from '@repo/db'
import type { FormVersionDocument } from '@repo/domain'

import { domain as domainSvc } from '../src/domain'
import { databaseRouter } from '../src/routers/database'
import { createCallerFactory } from '../src/trpc'

const RUN = randomUUID().slice(0, 8)
const EMAIL_SUFFIX = `+database-forms-management-${RUN}@anynote.dev`
const TEST_PLAN_SLUG = 'test-database-forms-pro'

function uuid7(): string {
  const chars = [...randomUUID()]
  chars[14] = '7'
  chars[19] = '8'
  return chars.join('')
}

function caller(userId: string) {
  return createCallerFactory(databaseRouter)({
    prisma,
    user: {
      id: userId,
      email: 'forms@example.test',
      firstName: 'Forms',
      lastName: 'Test',
      emailVerified: true,
    } as never,
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
  })
}

async function makeUser(label: string) {
  return prisma.user.create({
    data: {
      email: `${label}${EMAIL_SUFFIX}`,
      emailVerified: true,
      name: label,
      firstName: label,
      lastName: 'Forms',
    },
  })
}

const titleDocument = (title: string): FormVersionDocument => ({
  schemaVersion: 1,
  firstSectionId: 'section-1',
  presentation: {
    title,
    submitButtonText: 'Отправить',
    hideAnyNoteBranding: false,
  },
  sections: [{ id: 'section-1', title: 'Вопросы', questionIds: ['question-title'] }],
  questions: [
    {
      id: 'question-title',
      sectionId: 'section-1',
      property: { kind: 'TITLE' },
      label: 'Название',
      required: true,
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
  endings: [{ id: 'ending-1', title: 'Спасибо' }],
})
type Fixture = Awaited<ReturnType<typeof seed>>
let fixture: Fixture

async function seed() {
  const [owner, admin, creator, editor, viewer, outsider] = await Promise.all([
    makeUser('owner'),
    makeUser('admin'),
    makeUser('creator'),
    makeUser('editor'),
    makeUser('viewer'),
    makeUser('outsider'),
  ])
  const plan = await prisma.plan.upsert({
    where: { slug: TEST_PLAN_SLUG },
    create: {
      slug: TEST_PLAN_SLUG,
      name: 'Database forms test plan',
      sortOrder: 999,
      maxMembersPerWorkspace: 100,
      features: ['forms:conditional', 'forms:customSlug', 'forms:hideBranding'],
    },
    update: {
      features: ['forms:conditional', 'forms:customSlug', 'forms:hideBranding'],
    },
  })
  await prisma.subscription.create({
    data: { userId: owner.id, planId: plan.id },
  })
  const workspace = await prisma.workspace.create({
    data: { name: `Database forms ${RUN}`, createdById: owner.id },
  })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: workspace.id, userId: owner.id, role: 'OWNER' },
      { workspaceId: workspace.id, userId: admin.id, role: 'ADMIN' },
      { workspaceId: workspace.id, userId: creator.id, role: 'EDITOR' },
      { workspaceId: workspace.id, userId: editor.id, role: 'EDITOR' },
      { workspaceId: workspace.id, userId: viewer.id, role: 'VIEWER' },
    ],
  })
  const collection = await prisma.collection.create({
    data: {
      workspaceId: workspace.id,
      kind: CollectionKind.TEAM,
      title: 'Общее',
    },
  })
  const page = await prisma.page.create({
    data: {
      workspaceId: workspace.id,
      collectionId: collection.id,
      type: PageType.DATABASE,
      title: 'Ответы',
      createdById: creator.id,
    },
  })
  await domainSvc.database.seedDefaults(page.id, workspace.id, 'Ответы')
  return {
    workspaceId: workspace.id,
    pageId: page.id,
    ownerId: owner.id,
    adminId: admin.id,
    creatorId: creator.id,
    editorId: editor.id,
    viewerId: viewer.id,
    outsiderId: outsider.id,
  }
}

beforeAll(async () => {
  fixture = await seed()
})

afterAll(async () => {
  if (fixture?.workspaceId) {
    await prisma.workspace.deleteMany({ where: { id: fixture.workspaceId } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_SUFFIX } } })
  await prisma.plan.deleteMany({ where: { slug: TEST_PLAN_SLUG } })
})

describe('database form management router (real PostgreSQL)', () => {
  it('exposes the complete lifecycle, versions and keyset response surface', async () => {
    const owner = caller(fixture.ownerId)
    const created = await owner.createForm({
      pageId: fixture.pageId,
      title: 'Обратная связь',
    })

    expect(created).toMatchObject({ state: 'DRAFT', draftRevision: 1 })
    expect(created.routeKey).toMatch(/^anf_/)
    await expect(
      owner.getForm({ pageId: fixture.pageId, formId: created.id }),
    ).resolves.toMatchObject({ id: created.id })
    await expect(owner.listForms({ pageId: fixture.pageId })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created.id })]),
    )

    const draft = await owner.updateFormDraft({
      pageId: fixture.pageId,
      formId: created.id,
      expectedRevision: 1,
      schema: titleDocument('Обратная связь'),
    })
    expect(draft.draftRevision).toBe(2)

    const published = await owner.publishForm({ pageId: fixture.pageId, formId: created.id })
    expect(published).toMatchObject({ state: 'OPEN', versionNumber: 1 })
    await expect(
      owner.listFormVersions({ pageId: fixture.pageId, formId: created.id }),
    ).resolves.toMatchObject([{ formId: created.id, versionNumber: 1 }])

    const settings = await owner.updateFormSettings({
      pageId: fixture.pageId,
      formId: created.id,
      audience: 'SIGNED_IN_WITH_LINK',
      respondentAccess: 'VIEW',
      opensAt: null,
      closesAt: null,
      responseLimit: 25,
      notifyOwners: false,
    })
    expect(settings).toMatchObject({
      audience: 'SIGNED_IN_WITH_LINK',
      respondentAccess: 'VIEW',
      responseLimit: 25,
      notifyOwners: false,
    })

    const slugged = await owner.setFormSlug({
      pageId: fixture.pageId,
      formId: created.id,
      slug: `feedback-${RUN}`,
    })
    expect(slugged.customSlug).toBe(`feedback-${RUN}`)
    const rotated = await owner.rotateFormKey({ pageId: fixture.pageId, formId: created.id })
    expect(rotated.routeKey).not.toBe(created.routeKey)
    expect(rotated.linkRevision).toBe(slugged.linkRevision + 1)

    await expect(
      owner.closeForm({ pageId: fixture.pageId, formId: created.id }),
    ).resolves.toMatchObject({ state: 'CLOSED' })
    await expect(
      owner.reopenForm({ pageId: fixture.pageId, formId: created.id }),
    ).resolves.toMatchObject({ state: 'OPEN' })

    const version = await prisma.databaseFormVersion.findFirstOrThrow({
      where: { formId: created.id, versionNumber: 1 },
      select: { id: true },
    })
    const submittedAt = new Date('2026-07-16T00:00:00.000Z')
    const expectedIds: string[] = []
    for (let index = 0; index < 3; index += 1) {
      const row = await owner.createRow({
        pageId: fixture.pageId,
        title: `Ответ ${index + 1}`,
      })
      const submissionId = uuid7()
      expectedIds.push(submissionId)
      await prisma.databaseFormSubmission.create({
        data: {
          id: submissionId,
          formId: created.id,
          versionId: version.id,
          rowId: row.rowId,
          respondentUserId: fixture.ownerId,
          endingId: 'ending-1',
          idempotencyKey: uuid7(),
          submittedAt,
        },
      })
    }
    expectedIds.sort().reverse()

    const firstPage = await owner.listFormResponses({
      pageId: fixture.pageId,
      formId: created.id,
      limit: 2,
    })
    expect(firstPage.items.map(({ submissionId }) => submissionId)).toEqual(
      expectedIds.slice(0, 2),
    )
    expect(firstPage.nextCursor).toEqual({ submittedAt, id: expectedIds[1] })
    const secondPage = await owner.listFormResponses({
      pageId: fixture.pageId,
      formId: created.id,
      limit: 2,
      cursor: firstPage.nextCursor!,
    })
    expect(secondPage.items.map(({ submissionId }) => submissionId)).toEqual(
      expectedIds.slice(2),
    )
    expect(secondPage.nextCursor).toBeNull()

    await expect(
      owner.archiveForm({ pageId: fixture.pageId, formId: created.id }),
    ).resolves.toEqual({ ok: true })
    await expect(
      prisma.databaseForm.findUniqueOrThrow({ where: { id: created.id } }),
    ).resolves.toMatchObject({ state: 'ARCHIVED', viewId: null })
  })

  it('keeps page access as defense in depth and domain structure authority final', async () => {
    const owner = caller(fixture.ownerId)
    const admin = caller(fixture.adminId)
    const creator = caller(fixture.creatorId)
    const editor = caller(fixture.editorId)
    const viewer = caller(fixture.viewerId)
    const created = await creator.createForm({
      pageId: fixture.pageId,
      title: 'Права на форму',
    })
    await prisma.page.create({
      data: {
        workspaceId: fixture.workspaceId,
        type: PageType.TEXT,
        title: 'Hidden embed probe',
        createdById: fixture.ownerId,
        content: {
          type: 'doc',
          content: [{ type: 'embeddedDatabase', attrs: { viewId: created.viewId } }],
        },
      },
    })
    await expect(
      editor.archiveForm({ pageId: fixture.pageId, formId: created.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      editor.deleteView({ pageId: fixture.pageId, id: created.viewId! }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    await expect(
      editor.updateFormDraft({
        pageId: fixture.pageId,
        formId: created.id,
        expectedRevision: 1,
        schema: titleDocument('Редактор'),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      viewer.updateFormDraft({
        pageId: fixture.pageId,
        formId: created.id,
        expectedRevision: 1,
        schema: titleDocument('Наблюдатель'),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    const creatorDraft = await creator.updateFormDraft({
      pageId: fixture.pageId,
      formId: created.id,
      expectedRevision: 1,
      schema: titleDocument('Создатель'),
    })
    const adminDraft = await admin.updateFormDraft({
      pageId: fixture.pageId,
      formId: created.id,
      expectedRevision: creatorDraft.draftRevision,
      schema: titleDocument('Администратор'),
    })
    await expect(
      owner.updateFormDraft({
        pageId: fixture.pageId,
        formId: created.id,
        expectedRevision: adminDraft.draftRevision,
        schema: titleDocument('Владелец'),
      }),
    ).resolves.toMatchObject({ draftRevision: adminDraft.draftRevision + 1 })

    const baseSettings = {
      pageId: fixture.pageId,
      formId: created.id,
      audience: 'SIGNED_IN_WITH_LINK' as const,
      respondentAccess: 'VIEW' as const,
      opensAt: null,
      closesAt: null,
      notifyOwners: true,
    }
    await expect(
      editor.updateFormSettings({ ...baseSettings, responseLimit: 7 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      viewer.updateFormSettings({ ...baseSettings, responseLimit: 7 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      creator.updateFormSettings({ ...baseSettings, responseLimit: 8 }),
    ).resolves.toMatchObject({ responseLimit: 8 })
    await expect(
      admin.updateFormSettings({ ...baseSettings, responseLimit: 9 }),
    ).resolves.toMatchObject({ responseLimit: 9 })
    await expect(
      owner.updateFormSettings({ ...baseSettings, responseLimit: 10 }),
    ).resolves.toMatchObject({ responseLimit: 10 })

    await owner.setStructureLocked({ pageId: fixture.pageId, locked: true })
    await expect(
      creator.updateFormSettings({ ...baseSettings, responseLimit: 11 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      creator.updateFormDraft({
        pageId: fixture.pageId,
        formId: created.id,
        expectedRevision: adminDraft.draftRevision + 1,
        schema: titleDocument('Заблокировано'),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      admin.updateFormSettings({ ...baseSettings, responseLimit: 12 }),
    ).resolves.toMatchObject({ responseLimit: 12 })
    await owner.setStructureLocked({ pageId: fixture.pageId, locked: false })

    await expect(
      viewer.getForm({ pageId: fixture.pageId, formId: created.id }),
    ).resolves.toMatchObject({ id: created.id })
    await expect(viewer.listForms({ pageId: fixture.pageId })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created.id })]),
    )
  })

  it('filters response DTOs through PERSON and CREATED_BY rules with visible keysets', async () => {
    const owner = caller(fixture.ownerId)
    const editor = caller(fixture.editorId)
    const outsider = caller(fixture.outsiderId)
    const person = await owner.createProperty({
      pageId: fixture.pageId,
      type: 'PERSON',
      name: 'Ответственный',
    })
    const createdBy = await owner.createProperty({
      pageId: fixture.pageId,
      type: 'CREATED_BY',
      name: 'Автор',
    })
    await owner.createAccessRule({
      pageId: fixture.pageId,
      propertyId: person.id,
      accessLevel: 'CAN_VIEW',
    })
    await owner.createAccessRule({
      pageId: fixture.pageId,
      propertyId: createdBy.id,
      accessLevel: 'CAN_VIEW',
    })

    const form = await owner.createForm({ pageId: fixture.pageId, title: 'ACL responses' })
    await owner.publishForm({ pageId: fixture.pageId, formId: form.id })
    const version = await prisma.databaseFormVersion.findFirstOrThrow({
      where: { formId: form.id, versionNumber: 1 },
      select: { id: true },
    })
    const submittedAt = new Date('2026-07-16T01:00:00.000Z')
    const seeded: Array<{ id: string; visible: boolean }> = []
    const addSubmission = async (
      rowCaller: ReturnType<typeof caller>,
      title: string,
      personUserId: string | null,
      visible: boolean,
    ) => {
      const row = await rowCaller.createRow({ pageId: fixture.pageId, title })
      if (personUserId !== null) {
        await owner.updateCellValue({
          pageId: fixture.pageId,
          rowId: row.rowId,
          propertyId: person.id,
          value: personUserId,
        })
      }
      const id = uuid7()
      seeded.push({ id, visible })
      await prisma.databaseFormSubmission.create({
        data: {
          id,
          formId: form.id,
          versionId: version.id,
          rowId: row.rowId,
          endingId: 'ending-1',
          idempotencyKey: uuid7(),
          submittedAt,
        },
      })
    }
    await addSubmission(owner, 'PERSON match', fixture.editorId, true)
    await addSubmission(editor, 'CREATED_BY match 1', null, true)
    await addSubmission(owner, 'Hidden 1', null, false)
    await addSubmission(editor, 'CREATED_BY match 2', null, true)
    await addSubmission(owner, 'Hidden 2', fixture.viewerId, false)
    const expected = seeded
      .filter(({ visible }) => visible)
      .map(({ id }) => id)
      .sort()
      .reverse()

    const first = await editor.listFormResponses({
      pageId: fixture.pageId,
      formId: form.id,
      limit: 1,
    })
    const second = await editor.listFormResponses({
      pageId: fixture.pageId,
      formId: form.id,
      limit: 1,
      cursor: first.nextCursor!,
    })
    const third = await editor.listFormResponses({
      pageId: fixture.pageId,
      formId: form.id,
      limit: 1,
      cursor: second.nextCursor!,
    })
    expect(
      [...first.items, ...second.items, ...third.items].map((item) => item.submissionId),
    ).toEqual(expected)
    expect(third.nextCursor).toBeNull()
    for (const page of [first, second, third]) {
      const serialized = JSON.stringify(page)
      expect(serialized).not.toContain('idempotencyKey')
      expect(serialized).not.toContain('formId')
      expect(serialized).not.toContain('versionId')
      expect(serialized).not.toContain('respondentUserId')
      expect(page.items[0]?.row.cells).toBeDefined()
    }
    await expect(
      outsider.listFormResponses({ pageId: fixture.pageId, formId: form.id, limit: 10 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
