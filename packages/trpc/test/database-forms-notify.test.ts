import { describe, expect, it, vi } from 'vitest'

import { RoleType } from '@repo/db'

import { notifyFormManagers } from '../src/helpers/form-notify'
import { observeFormEvent, safeFormLogContext } from '../src/helpers/form-observability'

const FORM_ID = '00000000-0000-7000-8000-000000000001'
const VERSION_ID = '00000000-0000-7000-8000-000000000002'
const SUBMISSION_ID = '00000000-0000-7000-8000-000000000003'
const ROW_ID = '00000000-0000-7000-8000-000000000004'
const WORKSPACE_ID = '00000000-0000-7000-8000-000000000005'
const PAGE_ID = '00000000-0000-7000-8000-000000000006'
const VIEW_ID = '00000000-0000-7000-8000-000000000007'
const CREATOR_ID = '00000000-0000-7000-8000-000000000008'
const OWNER_ID = '00000000-0000-7000-8000-000000000009'
const ADMIN_ID = '00000000-0000-7000-8000-00000000000a'
const BLOCKED_ADMIN_ID = '00000000-0000-7000-8000-00000000000b'

function submission(overrides: Record<string, unknown> = {}) {
  return {
    rowId: ROW_ID,
    respondentUserId: null,
    submittedAt: new Date('2026-07-16T12:30:00.000Z'),
    version: { versionNumber: 3 },
    form: {
      id: FORM_ID,
      createdById: CREATOR_ID,
      notifyOwners: true,
      viewId: VIEW_ID,
      view: { title: 'Заявка на участие' },
      source: {
        workspaceId: WORKSPACE_ID,
        pageId: PAGE_ID,
        title: 'Заявки',
        page: { title: 'Заявки' },
      },
    },
    ...overrides,
  }
}

function harness(
  options: {
    record?: ReturnType<typeof submission> | null
    memberships?: { userId: string; role: RoleType }[]
    blockedIds?: string[]
  } = {},
) {
  const findUnique = vi.fn(async () =>
    options.record === undefined ? submission() : options.record,
  )
  const findManyMembers = vi.fn(
    async () =>
      options.memberships ?? [
        { userId: CREATOR_ID, role: RoleType.EDITOR },
        { userId: OWNER_ID, role: RoleType.OWNER },
        { userId: ADMIN_ID, role: RoleType.ADMIN },
        { userId: BLOCKED_ADMIN_ID, role: RoleType.ADMIN },
      ],
  )
  const findManyBlocked = vi.fn(async () =>
    (options.blockedIds ?? [BLOCKED_ADMIN_ID]).map((userId) => ({ userId })),
  )
  const prisma = {
    databaseFormSubmission: { findUnique },
    workspaceMember: { findMany: findManyMembers },
    workspaceBlockedUser: { findMany: findManyBlocked },
  }
  const emitNotification = vi.fn(async () => ({}))
  return { prisma, emitNotification, findUnique, findManyMembers, findManyBlocked }
}

describe('database form submission notifications', () => {
  it('notifies the active creator and current OWNER/ADMIN exactly once with metadata only', async () => {
    const { prisma, emitNotification } = harness()

    await notifyFormManagers(prisma as never, SUBMISSION_ID, { emitNotification })

    expect(emitNotification).toHaveBeenCalledTimes(3)
    expect(emitNotification.mock.calls.map(([, args]) => args.userId).sort()).toEqual(
      [ADMIN_ID, CREATOR_ID, OWNER_ID].sort(),
    )
    expect(emitNotification).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        type: 'FORM_SUBMITTED',
        workspaceId: WORKSPACE_ID,
        resourceUrl: `/workspaces/${WORKSPACE_ID}/pages/${PAGE_ID}?viewId=${VIEW_ID}`,
        payload: {
          formId: FORM_ID,
          versionNumber: 3,
          rowId: ROW_ID,
          formLabel: 'Заявка на участие',
          submittedAt: '2026-07-16T12:30:00.000Z',
          resourceUrl: `/workspaces/${WORKSPACE_ID}/pages/${PAGE_ID}?viewId=${VIEW_ID}`,
        },
      }),
    )
    const serialized = JSON.stringify(emitNotification.mock.calls)
    for (const forbidden of ['answers', 'email', 'captcha', 'uploadToken', 'locator']) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })

  it('does nothing when owner notifications are disabled', async () => {
    const { prisma, emitNotification, findManyMembers } = harness({
      record: submission({ form: { ...submission().form, notifyOwners: false } }),
    })

    await notifyFormManagers(prisma as never, SUBMISSION_ID, { emitNotification })

    expect(findManyMembers).not.toHaveBeenCalled()
    expect(emitNotification).not.toHaveBeenCalled()
  })

  it('excludes a non-manager respondent but retains a respondent who is a manager', async () => {
    const creatorRespondent = harness({
      record: submission({ respondentUserId: CREATOR_ID }),
      memberships: [
        { userId: CREATOR_ID, role: RoleType.EDITOR },
        { userId: OWNER_ID, role: RoleType.OWNER },
      ],
      blockedIds: [],
    })
    await notifyFormManagers(creatorRespondent.prisma as never, SUBMISSION_ID, {
      emitNotification: creatorRespondent.emitNotification,
    })
    expect(creatorRespondent.emitNotification).toHaveBeenCalledOnce()
    expect(creatorRespondent.emitNotification.mock.calls[0]?.[1].userId).toBe(OWNER_ID)

    const ownerRespondent = harness({
      record: submission({ respondentUserId: OWNER_ID }),
      memberships: [
        { userId: CREATOR_ID, role: RoleType.EDITOR },
        { userId: OWNER_ID, role: RoleType.OWNER },
      ],
      blockedIds: [],
    })
    await notifyFormManagers(ownerRespondent.prisma as never, SUBMISSION_ID, {
      emitNotification: ownerRespondent.emitNotification,
    })
    expect(ownerRespondent.emitNotification).toHaveBeenCalledTimes(2)
  })
})

describe('database form observability sanitizer', () => {
  it('keeps only bounded internal metadata', () => {
    expect(
      safeFormLogContext({
        formId: FORM_ID,
        versionId: VERSION_ID,
        versionNumber: 2,
        outcome: 'accepted',
        reason: 'captcha',
        durationMs: 12.5,
        uploadCleanupCount: 4,
        acceptedResponseCount: 7,
        locator: 'secret-slug',
        answers: { email: 'secret@example.test' },
        email: 'a@b.test',
        ip: '203.0.113.10',
        captcha: 'secret',
      }),
    ).toEqual({
      formId: FORM_ID,
      versionId: VERSION_ID,
      versionNumber: 2,
      outcome: 'accepted',
      reason: 'captcha',
      durationMs: 12.5,
      uploadCleanupCount: 4,
      acceptedResponseCount: 7,
    })
  })

  it('drops malformed IDs and unbounded labels', () => {
    expect(
      safeFormLogContext({
        formId: 'secret-slug',
        versionId: 'not-a-uuid',
        outcome: 'answer: secret',
        reason: 'secret@example.test',
        durationMs: Number.POSITIVE_INFINITY,
        uploadCleanupCount: 1.5,
      }),
    ).toEqual({})
  })

  it('emits a real structured log with sanitized fields only', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    observeFormEvent('submit', {
      formId: FORM_ID,
      versionNumber: 2,
      outcome: 'accepted',
      durationMs: 15,
      locator: 'secret-slug',
      email: 'secret@example.test',
      answers: { message: 'private' },
    })

    expect(info).toHaveBeenCalledWith('[database.forms]', {
      event: 'submit',
      formId: FORM_ID,
      versionNumber: 2,
      outcome: 'accepted',
      durationMs: 15,
    })
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/secret-slug|secret@example|private/)
    info.mockRestore()
  })
})
