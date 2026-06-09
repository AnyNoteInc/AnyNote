import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, CollectionKind } from '@repo/db'

import { databaseRouter } from '../src/routers/database'
import { notificationRouter } from '../src/routers/notification'
import { domain as domainSvc } from '../src/domain'
import { createCallerFactory } from '../src/trpc'

// Real-DB integration test for Phase-5 database notifications wired into the
// updateCellValue path: person-assignment → DATABASE_PERSON_ASSIGNED to the
// assignee; any property change → DATABASE_UPDATE to ALL_UPDATES-pref users; a
// STATUS/PERSON/DATE change → also to IMPORTANT_UPDATES-pref users; an unrelated
// (TEXT) change → NOT to IMPORTANT_UPDATES; recipients are filtered by ROW
// ACCESS (a user without row access gets no content-bearing notification); the
// actor never self-notifies.
//
// Self-cleaning via an email-suffix namespace; requires `docker compose up -d`.

const EMAIL_SUFFIX = '+database-notify-test@anynote.dev'

async function cleanFixtures() {
  await prisma.notificationInApp.deleteMany({
    where: { user: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.notificationDelivery.deleteMany({
    where: { user: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.notificationEvent.deleteMany({
    where: { user: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.pageNotificationPreference.deleteMany({
    where: { user: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.databasePageAccessRule.deleteMany({
    where: { source: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } } },
  })
  await prisma.databaseCellValue.deleteMany({
    where: { property: { source: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } } } },
  })
  await prisma.databaseRow.deleteMany({
    where: { source: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } } },
  })
  await prisma.databaseProperty.deleteMany({
    where: { source: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } } },
  })
  await prisma.databaseView.deleteMany({
    where: { source: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } } },
  })
  await prisma.databaseSource.deleteMany({
    where: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } },
  })
  await prisma.page.deleteMany({
    where: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } },
  })
  await prisma.collection.deleteMany({
    where: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } },
  })
  await prisma.workspaceMember.deleteMany({
    where: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } },
  })
  await prisma.workspace.deleteMany({
    where: { createdBy: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
}

async function makeUser(label: string) {
  return prisma.user.create({
    data: {
      email: `${label}${EMAIL_SUFFIX}`,
      emailVerified: true,
      name: label,
      firstName: label,
      lastName: 'Test',
    },
  })
}

function makeCtx(userId: string) {
  return {
    prisma,
    user: {
      id: userId,
      email: 'x',
      firstName: 'T',
      lastName: 'U',
      emailVerified: true,
    } as never,
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
  }
}
function dbCaller(userId: string) {
  return createCallerFactory(databaseRouter)(makeCtx(userId))
}
function notifCaller(userId: string) {
  return createCallerFactory(notificationRouter)(makeCtx(userId))
}

// owner (OWNER, actor) + member (EDITOR) + a DATABASE page with STATUS, PERSON,
// and TEXT properties and one row.
async function seed() {
  const owner = await makeUser('owner')
  const member = await makeUser('member')
  const ws = await prisma.workspace.create({
    data: { name: 'DBNotifyWS', createdById: owner.id },
    select: { id: true },
  })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
      { workspaceId: ws.id, userId: member.id, role: 'EDITOR' },
    ],
  })
  const team = await prisma.collection.create({
    data: { workspaceId: ws.id, kind: CollectionKind.TEAM, title: 'Общее' },
    select: { id: true },
  })
  const page = await prisma.page.create({
    data: { workspaceId: ws.id, collectionId: team.id, type: 'DATABASE', title: 'DB', createdById: owner.id },
    select: { id: true },
  })
  await domainSvc.database.seedDefaults(page.id, ws.id, 'DB')

  const c = dbCaller(owner.id)
  const statusProp = await c.createProperty({
    pageId: page.id,
    type: 'STATUS',
    name: 'Статус',
    settings: { options: [{ id: 'opt-todo', label: 'К работе', color: '#999' }] },
  })
  const personProp = await c.createProperty({ pageId: page.id, type: 'PERSON', name: 'Исполнитель' })
  const textProp = await c.createProperty({ pageId: page.id, type: 'TEXT', name: 'Заметка' })
  const row = await c.createRow({ pageId: page.id, title: 'Row 1' })

  return {
    owner,
    member,
    wsId: ws.id,
    pageId: page.id,
    rowId: row.rowId,
    statusProp,
    personProp,
    textProp,
  }
}

async function inAppFor(userId: string, type: string) {
  return prisma.notificationInApp.findMany({
    where: { userId, event: { type: type as never } },
    include: { event: true },
  })
}

describe('database update notifications', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('assigning a user to a PERSON property notifies that assignee', async () => {
    const fx = await seed()
    await dbCaller(fx.owner.id).updateCellValue({
      pageId: fx.pageId,
      rowId: fx.rowId,
      propertyId: fx.personProp.id,
      value: fx.member.id,
    })
    const assigned = await inAppFor(fx.member.id, 'DATABASE_PERSON_ASSIGNED')
    expect(assigned.length).toBe(1)
  })

  it('a STATUS change notifies an IMPORTANT_UPDATES-pref user (DATABASE_UPDATE)', async () => {
    const fx = await seed()
    await notifCaller(fx.member.id).setPageNotificationPreference({
      pageId: fx.pageId,
      level: 'IMPORTANT_UPDATES',
    })
    await dbCaller(fx.owner.id).updateCellValue({
      pageId: fx.pageId,
      rowId: fx.rowId,
      propertyId: fx.statusProp.id,
      value: 'opt-todo',
    })
    const got = await inAppFor(fx.member.id, 'DATABASE_UPDATE')
    expect(got.length).toBe(1)
  })

  it('a TEXT-property change does NOT notify an IMPORTANT_UPDATES-pref user', async () => {
    const fx = await seed()
    await notifCaller(fx.member.id).setPageNotificationPreference({
      pageId: fx.pageId,
      level: 'IMPORTANT_UPDATES',
    })
    await dbCaller(fx.owner.id).updateCellValue({
      pageId: fx.pageId,
      rowId: fx.rowId,
      propertyId: fx.textProp.id,
      value: 'just a note',
    })
    const got = await inAppFor(fx.member.id, 'DATABASE_UPDATE')
    expect(got.length).toBe(0)
  })

  it('a TEXT-property change DOES notify an ALL_UPDATES-pref user', async () => {
    const fx = await seed()
    await notifCaller(fx.member.id).setPageNotificationPreference({
      pageId: fx.pageId,
      level: 'ALL_UPDATES',
    })
    await dbCaller(fx.owner.id).updateCellValue({
      pageId: fx.pageId,
      rowId: fx.rowId,
      propertyId: fx.textProp.id,
      value: 'just a note',
    })
    const got = await inAppFor(fx.member.id, 'DATABASE_UPDATE')
    expect(got.length).toBe(1)
  })

  it('the actor does not notify self even with a pref', async () => {
    const fx = await seed()
    await notifCaller(fx.owner.id).setPageNotificationPreference({
      pageId: fx.pageId,
      level: 'ALL_UPDATES',
    })
    await dbCaller(fx.owner.id).updateCellValue({
      pageId: fx.pageId,
      rowId: fx.rowId,
      propertyId: fx.textProp.id,
      value: 'mine',
    })
    const got = await inAppFor(fx.owner.id, 'DATABASE_UPDATE')
    expect(got.length).toBe(0)
  })

  it('a user without ROW access gets no content-bearing DATABASE_UPDATE', async () => {
    const fx = await seed()
    // member opts into ALL_UPDATES, but a PERSON access rule restricts rows to
    // their assignee — member is NOT assigned, so they lose access to this row.
    await notifCaller(fx.member.id).setPageNotificationPreference({
      pageId: fx.pageId,
      level: 'ALL_UPDATES',
    })
    await dbCaller(fx.owner.id).createAccessRule({
      pageId: fx.pageId,
      propertyId: fx.personProp.id,
      accessLevel: 'CAN_EDIT_CONTENT',
    })
    // owner (FULL_ACCESS) changes the TEXT cell. member can't view the row →
    // no DATABASE_UPDATE leaks to them.
    await dbCaller(fx.owner.id).updateCellValue({
      pageId: fx.pageId,
      rowId: fx.rowId,
      propertyId: fx.textProp.id,
      value: 'secret note',
    })
    const got = await inAppFor(fx.member.id, 'DATABASE_UPDATE')
    expect(got.length).toBe(0)
  })
})
