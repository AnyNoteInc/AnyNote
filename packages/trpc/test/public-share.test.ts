import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@repo/db'

import { pageShareRouter } from '../src/routers/page-share'
import { createCallerFactory } from '../src/trpc'

// Real-DB integration test for the public link/site management procedures on
// the page-share router (link/site settings, publish/unpublish, password).
// Self-contained: creates its own users, plans, subscriptions, workspace and
// page inline, so it passes on a fresh CI DB without relying on seed data.
// Requires `docker compose up -d` (postgres) like the other integration tests.

const EMAIL_SUFFIX = '+public-share-test@anynote.dev'
const PLAN_SLUG_SITES = 'public-share-test-sites'
const PLAN_SLUG_NOSITES = 'public-share-test-nosites'

async function cleanFixtures() {
  await prisma.pageShare.deleteMany({
    where: { page: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } } },
  })
  await prisma.page.deleteMany({
    where: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } },
  })
  await prisma.subscription.deleteMany({
    where: { user: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.workspaceMember.deleteMany({
    where: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } },
  })
  await prisma.workspace.deleteMany({
    where: { createdBy: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
  await prisma.plan.deleteMany({ where: { slug: { in: [PLAN_SLUG_SITES, PLAN_SLUG_NOSITES] } } })
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

function makeCaller(userId: string) {
  return createCallerFactory(pageShareRouter)({
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

async function ensurePlan(slug: string, features: string[]) {
  return prisma.plan.upsert({
    where: { slug },
    create: {
      slug,
      name: slug,
      maxMembersPerWorkspace: 5,
      features: features as never,
    },
    update: { features: features as never },
    select: { id: true },
  })
}

async function giveActiveSubscription(userId: string, planId: string) {
  await prisma.subscription.create({
    data: {
      userId,
      planId,
      status: 'ACTIVE',
      billingPeriod: 'MONTHLY',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86400_000),
    },
  })
}

// Seed: owner (OWNER) + a plain member (VIEWER, not creator/owner/admin),
// a workspace, and a single page. The owner's plan controls publicSitesEnabled.
async function seed(opts: { publicSites: boolean }) {
  const owner = await makeUser('owner')
  const member = await makeUser('member')

  // Self-contained plan + active subscription so the FORBIDDEN/enabled paths
  // do not depend on seeded `personal`/`pro` plans existing on a fresh DB.
  const plan = await ensurePlan(
    opts.publicSites ? PLAN_SLUG_SITES : PLAN_SLUG_NOSITES,
    opts.publicSites ? ['publicSites'] : [],
  )
  await giveActiveSubscription(owner.id, plan.id)

  const ws = await prisma.workspace.create({
    data: { name: 'ShareWS', createdById: owner.id },
    select: { id: true },
  })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
      { workspaceId: ws.id, userId: member.id, role: 'VIEWER' },
    ],
  })
  const page = await prisma.page.create({
    data: {
      workspaceId: ws.id,
      type: 'TEXT',
      title: 'Shared page',
      createdById: owner.id,
      updatedById: owner.id,
    },
    select: { id: true },
  })
  return { wsId: ws.id, ownerId: owner.id, memberId: member.id, pageId: page.id }
}

describe('public link/site settings (integration)', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('updatePublicLinkSettings sets access/linkRole/expiresAt', async () => {
    const fx = await seed({ publicSites: false })
    const caller = makeCaller(fx.ownerId)
    const expiresAt = new Date(Date.now() + 7 * 86400_000)

    await caller.updatePublicLinkSettings({
      pageId: fx.pageId,
      access: 'PUBLIC',
      linkRole: 'EDITOR',
      expiresAt,
    })

    const row = await prisma.pageShare.findUnique({
      where: { pageId: fx.pageId },
      select: { access: true, linkRole: true, expiresAt: true },
    })
    expect(row?.access).toBe('PUBLIC')
    expect(row?.linkRole).toBe('EDITOR')
    expect(row?.expiresAt?.getTime()).toBe(expiresAt.getTime())
  })

  it('updatePublicSiteSettings sets toggles + analytics ids', async () => {
    const fx = await seed({ publicSites: false })
    const caller = makeCaller(fx.ownerId)

    await caller.updatePublicSiteSettings({
      pageId: fx.pageId,
      allowIndexing: true,
      allowCopy: true,
      publishSubpages: false,
      analyticsGoogleId: 'G-12345',
      analyticsYandexMetricaId: '99887766',
    })

    const row = await prisma.pageShare.findUnique({
      where: { pageId: fx.pageId },
      select: {
        allowIndexing: true,
        allowCopy: true,
        publishSubpages: true,
        analyticsGoogleId: true,
        analyticsYandexMetricaId: true,
      },
    })
    expect(row?.allowIndexing).toBe(true)
    expect(row?.allowCopy).toBe(true)
    expect(row?.publishSubpages).toBe(false)
    expect(row?.analyticsGoogleId).toBe('G-12345')
    expect(row?.analyticsYandexMetricaId).toBe('99887766')
  })

  it('publishSite sets mode=SITE + publishedAt when publicSitesEnabled', async () => {
    const fx = await seed({ publicSites: true })
    const caller = makeCaller(fx.ownerId)

    await caller.publishSite({ pageId: fx.pageId })

    const row = await prisma.pageShare.findUnique({
      where: { pageId: fx.pageId },
      select: { mode: true, publishedAt: true, unpublishedAt: true },
    })
    expect(row?.mode).toBe('SITE')
    expect(row?.publishedAt).not.toBeNull()
    expect(row?.unpublishedAt).toBeNull()
  })

  it('publishSite throws FORBIDDEN when publicSites not enabled', async () => {
    const fx = await seed({ publicSites: false })
    const caller = makeCaller(fx.ownerId)

    await expect(caller.publishSite({ pageId: fx.pageId })).rejects.toThrow(/Публичные сайты/)
  })

  it('unpublishSite sets unpublishedAt', async () => {
    const fx = await seed({ publicSites: true })
    const caller = makeCaller(fx.ownerId)

    await caller.publishSite({ pageId: fx.pageId })
    await caller.unpublishSite({ pageId: fx.pageId })

    const row = await prisma.pageShare.findUnique({
      where: { pageId: fx.pageId },
      select: { unpublishedAt: true },
    })
    expect(row?.unpublishedAt).not.toBeNull()
  })

  it('setExposesAt stores and clears the scheduled-publish date', async () => {
    const fx = await seed({ publicSites: true })
    const caller = makeCaller(fx.ownerId)
    const exposesAt = new Date(Date.now() + 3 * 86400_000)

    await caller.setExposesAt({ pageId: fx.pageId, exposesAt })
    let row = await prisma.pageShare.findUnique({
      where: { pageId: fx.pageId },
      select: { exposesAt: true },
    })
    expect(row?.exposesAt?.getTime()).toBe(exposesAt.getTime())

    await caller.setExposesAt({ pageId: fx.pageId, exposesAt: null })
    row = await prisma.pageShare.findUnique({
      where: { pageId: fx.pageId },
      select: { exposesAt: true },
    })
    expect(row?.exposesAt).toBeNull()
  })

  it('setSharePassword stores a non-plaintext salted hash; clearSharePassword nulls it', async () => {
    const fx = await seed({ publicSites: true })
    const caller = makeCaller(fx.ownerId)
    const password = 'super-secret-123'

    await caller.setSharePassword({ pageId: fx.pageId, password })

    const row = await prisma.pageShare.findUnique({
      where: { pageId: fx.pageId },
      select: { passwordHash: true },
    })
    expect(row?.passwordHash).toBeTruthy()
    expect(row?.passwordHash).not.toBe(password)
    expect(row?.passwordHash).toContain(':') // salt:hash

    // `get` exposes a boolean, never the raw hash.
    const got = await caller.get({ pageId: fx.pageId })
    expect(got.share?.hasPassword).toBe(true)
    expect((got.share as Record<string, unknown>).passwordHash).toBeUndefined()

    await caller.clearSharePassword({ pageId: fx.pageId })
    const cleared = await prisma.pageShare.findUnique({
      where: { pageId: fx.pageId },
      select: { passwordHash: true },
    })
    expect(cleared?.passwordHash).toBeNull()
  })

  it('get returns the new site fields', async () => {
    const fx = await seed({ publicSites: true })
    const caller = makeCaller(fx.ownerId)

    await caller.publishSite({ pageId: fx.pageId })
    const got = await caller.get({ pageId: fx.pageId })

    expect(got.share?.mode).toBe('SITE')
    expect(got.share?.publishedAt).not.toBeNull()
    expect(got.share?.hasPassword).toBe(false)
    expect(got.share).toHaveProperty('allowIndexing')
    expect(got.share).toHaveProperty('allowCopy')
    expect(got.share).toHaveProperty('publishSubpages')
    expect(got.share).toHaveProperty('analyticsGoogleId')
    expect(got.share).toHaveProperty('analyticsYandexMetricaId')
    expect(got.share).toHaveProperty('exposesAt')
  })
})

describe('public-share management is manager-only (integration)', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('a non-manager member gets FORBIDDEN on each management procedure', async () => {
    const fx = await seed({ publicSites: true })
    const caller = makeCaller(fx.memberId)
    const forbid = /Недостаточно прав/

    await expect(
      caller.updatePublicLinkSettings({
        pageId: fx.pageId,
        access: 'PUBLIC',
        linkRole: 'READER',
      }),
    ).rejects.toThrow(forbid)
    await expect(
      caller.updatePublicSiteSettings({
        pageId: fx.pageId,
        allowIndexing: true,
        allowCopy: true,
        publishSubpages: true,
      }),
    ).rejects.toThrow(forbid)
    await expect(caller.publishSite({ pageId: fx.pageId })).rejects.toThrow(forbid)
    await expect(caller.unpublishSite({ pageId: fx.pageId })).rejects.toThrow(forbid)
    await expect(caller.setExposesAt({ pageId: fx.pageId, exposesAt: null })).rejects.toThrow(forbid)
    await expect(
      caller.setSharePassword({ pageId: fx.pageId, password: 'x' }),
    ).rejects.toThrow(forbid)
    await expect(caller.clearSharePassword({ pageId: fx.pageId })).rejects.toThrow(forbid)
  })
})

// ── Phase 8C: workspace security policy enforcement at the sharing chokepoints.
// The policy row is created directly via prisma (the tRPC security router is a
// later task); the procedures must consult it through the domain singleton.
// Pinned BOTH ways: more-public transitions deny, closing down stays allowed.
describe('security policy enforcement on sharing (8C §4, integration)', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  const linksPolicyDenied = /Публичные ссылки и сайты отключены/
  const guestsPolicyDenied = /Гостевые приглашения отключены/
  const copyPolicyDenied = /Копирование в другие пространства отключено/

  function enablePolicy(wsId: string, ownerId: string, flags: Record<string, boolean>) {
    return prisma.workspaceSecurityPolicy.create({
      data: { workspaceId: wsId, configuredById: ownerId, ...flags },
    })
  }

  it('setAccess to PUBLIC is denied under disablePublicLinksSitesForms', async () => {
    const fx = await seed({ publicSites: false })
    const caller = makeCaller(fx.ownerId)
    await caller.ensure({ pageId: fx.pageId })
    await enablePolicy(fx.wsId, fx.ownerId, { disablePublicLinksSitesForms: true })

    await expect(
      caller.setAccess({ pageId: fx.pageId, access: 'PUBLIC', linkRole: 'READER' }),
    ).rejects.toThrow(linksPolicyDenied)

    const row = await prisma.pageShare.findUnique({
      where: { pageId: fx.pageId },
      select: { access: true },
    })
    expect(row?.access).toBe('RESTRICTED')
  })

  it('setAccess to RESTRICTED stays allowed under the policy (owners can close down)', async () => {
    const fx = await seed({ publicSites: false })
    const caller = makeCaller(fx.ownerId)
    await caller.ensure({ pageId: fx.pageId })
    await caller.setAccess({ pageId: fx.pageId, access: 'PUBLIC', linkRole: 'READER' })
    await enablePolicy(fx.wsId, fx.ownerId, { disablePublicLinksSitesForms: true })

    await caller.setAccess({ pageId: fx.pageId, access: 'RESTRICTED', linkRole: 'READER' })

    const row = await prisma.pageShare.findUnique({
      where: { pageId: fx.pageId },
      select: { access: true },
    })
    expect(row?.access).toBe('RESTRICTED')
  })

  it('updatePublicLinkSettings: PUBLIC denied, RESTRICTED allowed under the policy', async () => {
    const fx = await seed({ publicSites: false })
    const caller = makeCaller(fx.ownerId)
    await enablePolicy(fx.wsId, fx.ownerId, { disablePublicLinksSitesForms: true })

    await expect(
      caller.updatePublicLinkSettings({ pageId: fx.pageId, access: 'PUBLIC', linkRole: 'READER' }),
    ).rejects.toThrow(linksPolicyDenied)

    await caller.updatePublicLinkSettings({
      pageId: fx.pageId,
      access: 'RESTRICTED',
      linkRole: 'READER',
    })
    const row = await prisma.pageShare.findUnique({
      where: { pageId: fx.pageId },
      select: { access: true },
    })
    expect(row?.access).toBe('RESTRICTED')
  })

  it('publishSite is denied under the policy even on a sites-enabled plan', async () => {
    const fx = await seed({ publicSites: true })
    const caller = makeCaller(fx.ownerId)
    await enablePolicy(fx.wsId, fx.ownerId, { disablePublicLinksSitesForms: true })

    await expect(caller.publishSite({ pageId: fx.pageId })).rejects.toThrow(linksPolicyDenied)
  })

  it('unpublishSite stays allowed under the policy', async () => {
    const fx = await seed({ publicSites: true })
    const caller = makeCaller(fx.ownerId)
    await caller.publishSite({ pageId: fx.pageId })
    await enablePolicy(fx.wsId, fx.ownerId, { disablePublicLinksSitesForms: true })

    await caller.unpublishSite({ pageId: fx.pageId })

    const row = await prisma.pageShare.findUnique({
      where: { pageId: fx.pageId },
      select: { unpublishedAt: true },
    })
    expect(row?.unpublishedAt).not.toBeNull()
  })

  it('setExposesAt: scheduling (non-null) denied, clearing (null) allowed under the policy', async () => {
    const fx = await seed({ publicSites: true })
    const caller = makeCaller(fx.ownerId)
    const exposesAt = new Date(Date.now() + 3 * 86400_000)
    await caller.setExposesAt({ pageId: fx.pageId, exposesAt })
    await enablePolicy(fx.wsId, fx.ownerId, { disablePublicLinksSitesForms: true })

    await expect(
      caller.setExposesAt({ pageId: fx.pageId, exposesAt: new Date(Date.now() + 5 * 86400_000) }),
    ).rejects.toThrow(linksPolicyDenied)

    await caller.setExposesAt({ pageId: fx.pageId, exposesAt: null })
    const row = await prisma.pageShare.findUnique({
      where: { pageId: fx.pageId },
      select: { exposesAt: true },
    })
    expect(row?.exposesAt).toBeNull()
  })

  it('updatePublicSiteSettings: allowCopy:true is denied under disableMoveDuplicateOutsideWorkspace', async () => {
    const fx = await seed({ publicSites: false })
    const caller = makeCaller(fx.ownerId)
    await enablePolicy(fx.wsId, fx.ownerId, { disableMoveDuplicateOutsideWorkspace: true })

    await expect(
      caller.updatePublicSiteSettings({
        pageId: fx.pageId,
        allowIndexing: false,
        allowCopy: true,
        publishSubpages: false,
      }),
    ).rejects.toThrow(copyPolicyDenied)

    const row = await prisma.pageShare.findUnique({
      where: { pageId: fx.pageId },
      select: { allowCopy: true },
    })
    expect(row?.allowCopy ?? false).toBe(false)
  })

  it('updatePublicSiteSettings: allowCopy:false stays allowed under the copy policy', async () => {
    const fx = await seed({ publicSites: false })
    const caller = makeCaller(fx.ownerId)
    await enablePolicy(fx.wsId, fx.ownerId, { disableMoveDuplicateOutsideWorkspace: true })

    await caller.updatePublicSiteSettings({
      pageId: fx.pageId,
      allowIndexing: true,
      allowCopy: false,
      publishSubpages: true,
    })

    const row = await prisma.pageShare.findUnique({
      where: { pageId: fx.pageId },
      select: { allowCopy: true, allowIndexing: true },
    })
    expect(row?.allowCopy).toBe(false)
    expect(row?.allowIndexing).toBe(true)
  })

  it('updatePublicSiteSettings: allowCopy:true allowed when the copy flag is off (zero-value policy row)', async () => {
    const fx = await seed({ publicSites: false })
    const caller = makeCaller(fx.ownerId)
    // Policy row exists but disableMoveDuplicateOutsideWorkspace stays false —
    // the gate must be specific to the copy flag, not any policy row.
    await enablePolicy(fx.wsId, fx.ownerId, { disablePublicLinksSitesForms: true })

    await caller.updatePublicSiteSettings({
      pageId: fx.pageId,
      allowIndexing: false,
      allowCopy: true,
      publishSubpages: false,
    })

    const row = await prisma.pageShare.findUnique({
      where: { pageId: fx.pageId },
      select: { allowCopy: true },
    })
    expect(row?.allowCopy).toBe(true)
  })

  it('addUser for a non-member (a guest grant by definition) is denied under disableGuestInvites', async () => {
    const fx = await seed({ publicSites: false })
    const stranger = await makeUser('stranger')
    const caller = makeCaller(fx.ownerId)
    await caller.ensure({ pageId: fx.pageId })
    await enablePolicy(fx.wsId, fx.ownerId, { disableGuestInvites: true })

    await expect(
      caller.addUser({ pageId: fx.pageId, userId: stranger.id, role: 'READER' }),
    ).rejects.toThrow(guestsPolicyDenied)

    const grants = await prisma.pageShareUser.count({
      where: { user: { id: stranger.id } },
    })
    expect(grants).toBe(0)
  })

  it('addUser grants a non-member under the zero-value policy (no row)', async () => {
    const fx = await seed({ publicSites: false })
    const stranger = await makeUser('stranger')
    const caller = makeCaller(fx.ownerId)
    await caller.ensure({ pageId: fx.pageId })

    const res = await caller.addUser({ pageId: fx.pageId, userId: stranger.id, role: 'READER' })
    expect(res.role).toBe('READER')
  })
})
