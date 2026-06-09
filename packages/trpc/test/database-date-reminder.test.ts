import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, CollectionKind } from '@repo/db'

import { databaseRouter } from '../src/routers/database'
import { domain as domainSvc } from '../src/domain'
import { createCallerFactory } from '../src/trpc'

// Real-DB integration test for Phase-5 database DATE reminders (5.4):
//   - setDatabaseDateReminder creates the config + a NotificationDelivery whose
//     nextAttemptAt = <date cell value> - offsetMinutes (reusing rebuildDeliveries);
//   - clearDatabaseDateReminder cancels its pending deliveries;
//   - changing the DATE cell reschedules the owner's deliveries to the new date;
//   - getDatabaseDateReminder returns the caller's own config (or null);
//   - a user WITHOUT row access cannot set a reminder (FORBIDDEN/NOT_FOUND);
//   - the input is SELF-TARGET only — there is no userId field to target another.
//
// Self-cleaning via an email-suffix namespace; requires `docker compose up -d`.

const EMAIL_SUFFIX = '+database-date-reminder-test@anynote.dev'

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
  await prisma.databaseDateReminder.deleteMany({
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

// owner (OWNER) + member (EDITOR) + a DATABASE page with a DATE + PERSON
// property and one row.
async function seed() {
  const owner = await makeUser('owner')
  const member = await makeUser('member')
  const ws = await prisma.workspace.create({
    data: { name: 'DBDateReminderWS', createdById: owner.id },
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
  const dateProp = await c.createProperty({ pageId: page.id, type: 'DATE', name: 'Срок' })
  const personProp = await c.createProperty({ pageId: page.id, type: 'PERSON', name: 'Исполнитель' })
  const row = await c.createRow({ pageId: page.id, title: 'Row 1' })

  return {
    owner,
    member,
    wsId: ws.id,
    pageId: page.id,
    rowId: row.rowId,
    dateProp,
    personProp,
  }
}

function pendingDeliveriesFor(userId: string) {
  return prisma.notificationDelivery.findMany({
    where: {
      userId,
      event: { type: 'DATABASE_DATE_REMINDER' },
    },
    include: { event: true },
  })
}

describe('database date reminders (self-targeted)', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('setDatabaseDateReminder creates the config + a delivery with nextAttemptAt = date - offset', async () => {
    const fx = await seed()
    // A future due date so the delivery is not immediately in the past.
    const dueAt = new Date(Date.now() + 7 * 86_400_000)
    await dbCaller(fx.owner.id).updateCellValue({
      pageId: fx.pageId,
      rowId: fx.rowId,
      propertyId: fx.dateProp.id,
      dateValue: dueAt.toISOString(),
    })
    const offsetMinutes = 60
    await dbCaller(fx.owner.id).setDatabaseDateReminder({
      pageId: fx.pageId,
      propertyId: fx.dateProp.id,
      rowId: fx.rowId,
      offsetMinutes,
    })

    const config = await prisma.databaseDateReminder.findUnique({
      where: {
        propertyId_rowId_userId: {
          propertyId: fx.dateProp.id,
          rowId: fx.rowId,
          userId: fx.owner.id,
        },
      },
    })
    expect(config).not.toBeNull()
    expect(config?.offsetMinutes).toBe(offsetMinutes)

    const deliveries = await pendingDeliveriesFor(fx.owner.id)
    const inApp = deliveries.filter((d) => d.channel === 'IN_APP')
    expect(inApp.length).toBe(1)
    const expectedFireAt = new Date(dueAt.getTime() - offsetMinutes * 60_000)
    expect(inApp[0].nextAttemptAt.getTime()).toBe(expectedFireAt.getTime())
    expect(inApp[0].status).toBe('PENDING')
  })

  it('stores the config but creates no deliveries when the DATE cell is empty', async () => {
    const fx = await seed()
    await dbCaller(fx.owner.id).setDatabaseDateReminder({
      pageId: fx.pageId,
      propertyId: fx.dateProp.id,
      rowId: fx.rowId,
      offsetMinutes: 0,
    })
    const config = await prisma.databaseDateReminder.findUnique({
      where: {
        propertyId_rowId_userId: {
          propertyId: fx.dateProp.id,
          rowId: fx.rowId,
          userId: fx.owner.id,
        },
      },
    })
    expect(config).not.toBeNull()
    const deliveries = await pendingDeliveriesFor(fx.owner.id)
    expect(deliveries.length).toBe(0)
  })

  it('getDatabaseDateReminder returns the caller own config or null', async () => {
    const fx = await seed()
    const before = await dbCaller(fx.owner.id).getDatabaseDateReminder({
      pageId: fx.pageId,
      propertyId: fx.dateProp.id,
      rowId: fx.rowId,
    })
    expect(before).toBeNull()

    await dbCaller(fx.owner.id).setDatabaseDateReminder({
      pageId: fx.pageId,
      propertyId: fx.dateProp.id,
      rowId: fx.rowId,
      offsetMinutes: 1440,
    })
    const after = await dbCaller(fx.owner.id).getDatabaseDateReminder({
      pageId: fx.pageId,
      propertyId: fx.dateProp.id,
      rowId: fx.rowId,
    })
    expect(after?.offsetMinutes).toBe(1440)

    // It is the CALLER's own config: another user sees their own (null) config.
    const memberView = await dbCaller(fx.member.id).getDatabaseDateReminder({
      pageId: fx.pageId,
      propertyId: fx.dateProp.id,
      rowId: fx.rowId,
    })
    expect(memberView).toBeNull()
  })

  it('clearDatabaseDateReminder deletes the config and cancels pending deliveries', async () => {
    const fx = await seed()
    const dueAt = new Date(Date.now() + 7 * 86_400_000)
    await dbCaller(fx.owner.id).updateCellValue({
      pageId: fx.pageId,
      rowId: fx.rowId,
      propertyId: fx.dateProp.id,
      dateValue: dueAt.toISOString(),
    })
    await dbCaller(fx.owner.id).setDatabaseDateReminder({
      pageId: fx.pageId,
      propertyId: fx.dateProp.id,
      rowId: fx.rowId,
      offsetMinutes: 0,
    })
    expect((await pendingDeliveriesFor(fx.owner.id)).filter((d) => d.status === 'PENDING').length).toBeGreaterThan(0)

    await dbCaller(fx.owner.id).clearDatabaseDateReminder({
      pageId: fx.pageId,
      propertyId: fx.dateProp.id,
      rowId: fx.rowId,
    })
    const config = await prisma.databaseDateReminder.findUnique({
      where: {
        propertyId_rowId_userId: {
          propertyId: fx.dateProp.id,
          rowId: fx.rowId,
          userId: fx.owner.id,
        },
      },
    })
    expect(config).toBeNull()
    const stillPending = (await pendingDeliveriesFor(fx.owner.id)).filter((d) => d.status === 'PENDING')
    expect(stillPending.length).toBe(0)
  })

  it('changing the DATE cell reschedules the owner deliveries to the new date', async () => {
    const fx = await seed()
    const firstDue = new Date(Date.now() + 7 * 86_400_000)
    await dbCaller(fx.owner.id).updateCellValue({
      pageId: fx.pageId,
      rowId: fx.rowId,
      propertyId: fx.dateProp.id,
      dateValue: firstDue.toISOString(),
    })
    const offsetMinutes = 60
    await dbCaller(fx.owner.id).setDatabaseDateReminder({
      pageId: fx.pageId,
      propertyId: fx.dateProp.id,
      rowId: fx.rowId,
      offsetMinutes,
    })

    // Move the date forward by 3 days.
    const secondDue = new Date(firstDue.getTime() + 3 * 86_400_000)
    await dbCaller(fx.owner.id).updateCellValue({
      pageId: fx.pageId,
      rowId: fx.rowId,
      propertyId: fx.dateProp.id,
      dateValue: secondDue.toISOString(),
    })

    const inApp = (await pendingDeliveriesFor(fx.owner.id)).filter(
      (d) => d.channel === 'IN_APP' && d.status === 'PENDING',
    )
    expect(inApp.length).toBe(1)
    const expectedFireAt = new Date(secondDue.getTime() - offsetMinutes * 60_000)
    expect(inApp[0].nextAttemptAt.getTime()).toBe(expectedFireAt.getTime())
  })

  it('cancels deliveries when the DATE cell is cleared', async () => {
    const fx = await seed()
    const dueAt = new Date(Date.now() + 7 * 86_400_000)
    await dbCaller(fx.owner.id).updateCellValue({
      pageId: fx.pageId,
      rowId: fx.rowId,
      propertyId: fx.dateProp.id,
      dateValue: dueAt.toISOString(),
    })
    await dbCaller(fx.owner.id).setDatabaseDateReminder({
      pageId: fx.pageId,
      propertyId: fx.dateProp.id,
      rowId: fx.rowId,
      offsetMinutes: 0,
    })
    expect(
      (await pendingDeliveriesFor(fx.owner.id)).filter((d) => d.status === 'PENDING').length,
    ).toBeGreaterThan(0)

    // Clear the DATE cell → reschedule should cancel the deliveries.
    await dbCaller(fx.owner.id).updateCellValue({
      pageId: fx.pageId,
      rowId: fx.rowId,
      propertyId: fx.dateProp.id,
      dateValue: null,
    })
    const stillPending = (await pendingDeliveriesFor(fx.owner.id)).filter((d) => d.status === 'PENDING')
    expect(stillPending.length).toBe(0)
  })

  it('a user WITHOUT row access cannot set a reminder', async () => {
    const fx = await seed()
    // A PERSON access rule restricts rows to their assignee. The member is NOT
    // assigned, so they cannot view the row → cannot set a reminder.
    await dbCaller(fx.owner.id).createAccessRule({
      pageId: fx.pageId,
      propertyId: fx.personProp.id,
      accessLevel: 'CAN_EDIT_CONTENT',
    })
    await expect(
      dbCaller(fx.member.id).setDatabaseDateReminder({
        pageId: fx.pageId,
        propertyId: fx.dateProp.id,
        rowId: fx.rowId,
        offsetMinutes: 0,
      }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) })

    const config = await prisma.databaseDateReminder.findUnique({
      where: {
        propertyId_rowId_userId: {
          propertyId: fx.dateProp.id,
          rowId: fx.rowId,
          userId: fx.member.id,
        },
      },
    })
    expect(config).toBeNull()
  })

  it('the reminder is SELF-TARGET only — there is no way to target another user', async () => {
    const fx = await seed()
    const dueAt = new Date(Date.now() + 7 * 86_400_000)
    await dbCaller(fx.owner.id).updateCellValue({
      pageId: fx.pageId,
      rowId: fx.rowId,
      propertyId: fx.dateProp.id,
      dateValue: dueAt.toISOString(),
    })
    // Pass a userId field — it must be ignored/rejected (not honored).
    await dbCaller(fx.owner.id).setDatabaseDateReminder({
      pageId: fx.pageId,
      propertyId: fx.dateProp.id,
      rowId: fx.rowId,
      offsetMinutes: 0,
      // @ts-expect-error — the input has NO userId field; targeting others is impossible.
      userId: fx.member.id,
    })
    // The config is owned by the caller, never by the member.
    const ownerConfig = await prisma.databaseDateReminder.findUnique({
      where: {
        propertyId_rowId_userId: {
          propertyId: fx.dateProp.id,
          rowId: fx.rowId,
          userId: fx.owner.id,
        },
      },
    })
    expect(ownerConfig).not.toBeNull()
    const memberConfig = await prisma.databaseDateReminder.findUnique({
      where: {
        propertyId_rowId_userId: {
          propertyId: fx.dateProp.id,
          rowId: fx.rowId,
          userId: fx.member.id,
        },
      },
    })
    expect(memberConfig).toBeNull()
    // No deliveries leaked to the member.
    expect((await pendingDeliveriesFor(fx.member.id)).length).toBe(0)
  })
})
