import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, CollectionKind } from '@repo/db'

import { databaseRouter } from '../src/routers/database'
import { domain as domainSvc } from '../src/domain'
import { createCallerFactory } from '../src/trpc'

// Real-DB integration test for the Phase-4C page-level (row-level) access rules +
// structure lock. The AUTHORITATIVE proof is the TWO-USER restricted-visibility
// scenario: an owner U1 + a plain-EDITOR member U2 in the same workspace. With a
// CAN_VIEW rule on a PERSON property, U2 sees ONLY the rows whose PERSON cell is
// assigned to U2 — every other row is hidden server-side. The owner (broadest
// access) keeps seeing every row.
//
// Self-cleaning via an email-suffix namespace; requires `docker compose up -d`.

const EMAIL_SUFFIX = '+database-access-test@anynote.dev'

async function cleanFixtures() {
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

function caller(userId: string) {
  return createCallerFactory(databaseRouter)({
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
  })
}

// Seed an OWNER U1 + a plain-EDITOR member U2 in one workspace, a TEAM collection,
// and a DATABASE page (provisioned with the default TABLE view + STATUS property).
// U2 is added directly via Prisma `workspaceMember.create` with role EDITOR — the
// tRPC caller bypasses the onboarding/consents gate entirely (it never touches the
// protected layout), so no consent rows are needed for these procedures.
async function seed() {
  const owner = await makeUser('owner')
  const member = await makeUser('member')
  const ws = await prisma.workspace.create({
    data: { name: 'DatabaseAccessWS', createdById: owner.id },
    select: { id: true },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: member.id, role: 'EDITOR' },
  })
  const team = await prisma.collection.create({
    data: { workspaceId: ws.id, kind: CollectionKind.TEAM, title: 'Общее' },
    select: { id: true },
  })
  const dbPage = await prisma.page.create({
    data: {
      workspaceId: ws.id,
      collectionId: team.id,
      type: 'DATABASE',
      title: 'My Database',
      createdById: owner.id,
    },
    select: { id: true },
  })
  await domainSvc.database.seedDefaults(dbPage.id, ws.id, 'My Database')
  return { wsId: ws.id, ownerId: owner.id, memberId: member.id, pageId: dbPage.id }
}

// Owner creates a PERSON property "Owner" + 2 rows, assigns R1.Owner = U2 and
// R2.Owner = U1. Returns the property + row ids.
async function seedPersonRows(fx: { pageId: string; ownerId: string; memberId: string }) {
  const c = caller(fx.ownerId)
  const person = await c.createProperty({ pageId: fx.pageId, type: 'PERSON', name: 'Owner' })
  const r1 = await c.createRow({ pageId: fx.pageId, title: 'R1' })
  const r2 = await c.createRow({ pageId: fx.pageId, title: 'R2' })
  // R1 belongs to the member (U2); R2 belongs to the owner (U1).
  await c.updateCellValue({ pageId: fx.pageId, rowId: r1.rowId, propertyId: person.id, value: fx.memberId })
  await c.updateCellValue({ pageId: fx.pageId, rowId: r2.rowId, propertyId: person.id, value: fx.ownerId })
  return { personId: person.id, r1: r1.rowId, r2: r2.rowId }
}

describe('database access rules + structure lock router (integration)', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  // ── THE KEY TEST — restricted row visibility enforced end-to-end ──────────────
  it('with a CAN_VIEW rule: the member sees only their assigned row; the owner sees both', async () => {
    const fx = await seed()
    const { personId, r1, r2 } = await seedPersonRows(fx)
    const owner = caller(fx.ownerId)
    const member = caller(fx.memberId)

    // No rules yet → the member (a workspace EDITOR) sees ALL rows.
    const before = await member.listRows({ pageId: fx.pageId })
    expect(before.rows.map((r) => r.rowId).sort()).toEqual([r1, r2].sort())

    // Owner adds a CAN_VIEW rule on the "Owner" PERSON property.
    const rule = await owner.createAccessRule({
      pageId: fx.pageId,
      propertyId: personId,
      accessLevel: 'CAN_VIEW',
    })
    expect(rule.accessLevel).toBe('CAN_VIEW')
    expect(rule.enabled).toBe(true)

    // The member now sees ONLY R1 (assigned to them); R2 is hidden.
    const memberRows = await member.listRows({ pageId: fx.pageId })
    expect(memberRows.rows.map((r) => r.rowId)).toEqual([r1])

    // The owner (broadest access — OWNER/creator → FULL_ACCESS) still sees both.
    const ownerRows = await owner.listRows({ pageId: fx.pageId })
    expect(ownerRows.rows.map((r) => r.rowId).sort()).toEqual([r1, r2].sort())
  })

  it('no rules → the member sees all rows (behavior preserved)', async () => {
    const fx = await seed()
    const { r1, r2 } = await seedPersonRows(fx)
    const member = caller(fx.memberId)

    const rows = await member.listRows({ pageId: fx.pageId })
    expect(rows.rows.map((r) => r.rowId).sort()).toEqual([r1, r2].sort())
  })

  // ── Per-row CONTENT-edit gating ───────────────────────────────────────────────
  it('CAN_VIEW rule: the member cannot edit a hidden row, nor edit their viewable row', async () => {
    const fx = await seed()
    const { personId, r1, r2 } = await seedPersonRows(fx)
    const owner = caller(fx.ownerId)
    const member = caller(fx.memberId)

    await owner.createAccessRule({ pageId: fx.pageId, propertyId: personId, accessLevel: 'CAN_VIEW' })

    // R2 is hidden from the member → updating its cell is FORBIDDEN.
    await expect(
      member.updateCellValue({ pageId: fx.pageId, rowId: r2, propertyId: personId, value: fx.memberId }),
    ).rejects.toThrow(/прав/i)

    // R1 is viewable but the rule only grants CAN_VIEW (< CAN_EDIT_CONTENT) →
    // editing its cell is still FORBIDDEN.
    await expect(
      member.updateCellValue({ pageId: fx.pageId, rowId: r1, propertyId: personId, value: fx.memberId }),
    ).rejects.toThrow(/прав/i)
  })

  it('CAN_EDIT_CONTENT rule: the member CAN edit their viewable row', async () => {
    const fx = await seed()
    const { personId, r1 } = await seedPersonRows(fx)
    const owner = caller(fx.ownerId)
    const member = caller(fx.memberId)

    await owner.createAccessRule({
      pageId: fx.pageId,
      propertyId: personId,
      accessLevel: 'CAN_EDIT_CONTENT',
    })

    // R1 is assigned to the member with CAN_EDIT_CONTENT → editing a cell succeeds.
    // (Re-assign the PERSON cell to themselves; still a member → valid value.)
    const updated = await member.updateCellValue({
      pageId: fx.pageId,
      rowId: r1,
      propertyId: personId,
      value: fx.memberId,
    })
    expect(updated).toBeTruthy()
  })

  // ── Rule-target validation ────────────────────────────────────────────────────
  it('createAccessRule on a TEXT property → BAD_REQUEST', async () => {
    const fx = await seed()
    const owner = caller(fx.ownerId)
    const text = await owner.createProperty({ pageId: fx.pageId, type: 'TEXT', name: 'Заметка' })

    await expect(
      owner.createAccessRule({ pageId: fx.pageId, propertyId: text.id, accessLevel: 'CAN_VIEW' }),
    ).rejects.toThrow(/Человек|создано/i)
  })

  // ── Structure permissions + lock ──────────────────────────────────────────────
  it('a plain EDITOR member cannot createProperty even when unlocked; the owner can', async () => {
    const fx = await seed()
    const owner = caller(fx.ownerId)
    const member = caller(fx.memberId)

    // Structure requires OWNER/ADMIN/creator — a plain EDITOR is blocked.
    await expect(
      member.createProperty({ pageId: fx.pageId, type: 'TEXT', name: 'Нельзя' }),
    ).rejects.toThrow(/структур|прав/i)

    // The owner (also the creator) can create a property when unlocked.
    const prop = await owner.createProperty({ pageId: fx.pageId, type: 'TEXT', name: 'Можно' })
    expect(prop.id).toBeTruthy()
  })

  it('setStructureLocked(true) by the owner blocks the member from createProperty', async () => {
    const fx = await seed()
    const owner = caller(fx.ownerId)
    const member = caller(fx.memberId)

    await owner.setStructureLocked({ pageId: fx.pageId, locked: true })

    await expect(
      member.createProperty({ pageId: fx.pageId, type: 'TEXT', name: 'Заблокировано' }),
    ).rejects.toThrow(/структур|заблокирован|прав/i)
  })

  // ── myAccess view-model ───────────────────────────────────────────────────────
  it('getByPage().myAccess reflects the member caps (no structure edit, lock state)', async () => {
    const fx = await seed()
    const owner = caller(fx.ownerId)
    const member = caller(fx.memberId)

    const before = await member.getByPage({ pageId: fx.pageId })
    expect(before.myAccess).toEqual({
      canEditContent: true, // a workspace EDITOR with no rules → source-level content edit
      canEditStructure: false, // a plain EDITOR is never a structure editor
      structureLocked: false,
    })

    await owner.setStructureLocked({ pageId: fx.pageId, locked: true })

    const after = await member.getByPage({ pageId: fx.pageId })
    expect(after.myAccess.structureLocked).toBe(true)
    expect(after.myAccess.canEditStructure).toBe(false)

    // The owner sees full structure rights.
    const ownerView = await owner.getByPage({ pageId: fx.pageId })
    expect(ownerView.myAccess.canEditStructure).toBe(true)
  })
})
