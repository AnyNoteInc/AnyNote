import { expect, test, type Page } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs } from './helpers/auth'

/**
 * Phase 9E E2E (plan Task 7 / spec §8): the meeting-notes journeys, all asserted
 * IN-SESSION (the Playwright `webServer` is just `next dev` on port 3100 — there
 * is NO yjs server and, decisively, the meeting job runner calls apps/agents
 * SERVER-SIDE from the web process, so a browser `page.route` cannot intercept
 * the transcribe/summarize pipeline).
 *
 * Approach — SEED-AND-ASSERT (the dominant chat-E2E pattern): rather than drive
 * the live upload→transcribe→summarize pipeline (which needs a real/mock agents
 * service AND a workspace AI provider), we seed a READY `MeetingArtifact` +
 * `TranscriptSegment` + `ActionItem` rows directly via Prisma and assert the
 * `MeetingTranscriptPage` renders them deterministically. The upload-dialog test
 * asserts the CONSENT GATE only (the confirm button stays disabled until the
 * consent checkbox is checked) — it never completes the real pipeline. This
 * covers the page-render, the search filter, the consent gate, and the plan gate
 * (the upload entry hidden on a non-meetings tier) without any live agents call.
 *
 * Workspace creation goes through the UI form (the page-sharing / media-embeds
 * precedent): only that path provisions the TEAM/PERSONAL Collections the sidebar
 * page-tree section (and its «Новая страница» / «Загрузить встречу» buttons)
 * render under — a raw Prisma `workspace.create` has no collections and the
 * sidebar section stays hidden.
 *
 * Plan gating: `getWorkspaceFeatures` resolves the WORKSPACE OWNER's ACTIVE
 * subscription plan; `meetingsEnabled` is the `'meetings'` token in
 * `Plan.features`. A fresh signup is on `personal` (no meetings) → test (c)
 * asserts the «Загрузить встречу» entry is absent. Tests (a)/(b) flip the owner's
 * subscription to a meetings-enabled plan (pro/max, per the seed), then reload so
 * the server layout re-reads the upgraded plan.
 */

const password = 'SuperSecure123!'

test.setTimeout(180_000)

let prisma: typeof import('../../packages/db/src/index').prisma

// Workspaces created per test — cleaned in afterAll (the shared dev Postgres
// means each --retries attempt appends fresh rows; cleanup must never fail).
const seededWorkspaceIds = new Set<string>()

test.beforeAll(async () => {
  loadEnvFromRoot()
  const db = await import('../../packages/db/src/index')
  prisma = db.prisma
})

test.afterAll(async () => {
  if (!prisma) return
  try {
    if (seededWorkspaceIds.size > 0) {
      // Cascades drop pages, artifacts, segments, action items, files, members.
      await prisma.workspace
        .deleteMany({ where: { id: { in: [...seededWorkspaceIds] } } })
        .catch(() => {})
    }
  } finally {
    await prisma.$disconnect()
  }
})

/**
 * Sign up, then create the first workspace through the UI form (which provisions
 * the TEAM/PERSONAL collections + the start page + sets it active). Returns the
 * user id and the workspace id (resolved from the DB after creation).
 */
async function signUpAndCreateWorkspace(
  page: Page,
  tag: string,
  workspaceName: string,
): Promise<{ userId: string; workspaceId: string }> {
  const email = `${tag}+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Встреча', lastName: 'Тестов' })
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })

  await page.getByRole('textbox', { name: 'Название' }).fill(`${workspaceName} ${Date.now()}`)
  const createBtn = page.getByRole('button', { name: 'Создать пространство' })
  await expect(createBtn).toBeEnabled({ timeout: 20_000 })
  await createBtn.click()
  // Creation redirects through /app to a neutral start page. A generous timeout
  // absorbs cold next-dev compile of the heavy workspace routes on the first run.
  await page.waitForURL(/\/(pages|chats)\//, { timeout: 60_000 })

  const workspace = await prisma.workspace.findFirstOrThrow({
    where: { createdById: user.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  seededWorkspaceIds.add(workspace.id)
  return { userId: user.id, workspaceId: workspace.id }
}

/**
 * Flip the workspace OWNER's subscription to a meetings-enabled plan so
 * `getWorkspaceFeatures(workspace)` reports `meetingsEnabled: true`. Mirrors the
 * banya spec's plan upgrade. The seed marks pro + max with the `'meetings'`
 * token; we pick the first plan that carries it.
 */
async function enableMeetingsPlan(userId: string): Promise<void> {
  const plans = await prisma.plan.findMany({ select: { id: true, features: true } })
  const meetingsPlan = plans.find(
    (p) => Array.isArray(p.features) && (p.features as unknown[]).includes('meetings'),
  )
  if (!meetingsPlan) throw new Error('no plan with the "meetings" feature token is seeded')
  const now = new Date()
  const periodEnd = new Date(now)
  periodEnd.setMonth(periodEnd.getMonth() + 1)
  await prisma.subscription.updateMany({
    where: { userId, status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] } },
    data: { status: 'EXPIRED', expiredAt: now },
  })
  await prisma.subscription.create({
    data: {
      userId,
      planId: meetingsPlan.id,
      status: 'ACTIVE',
      billingPeriod: 'MONTHLY',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    },
  })
}

/**
 * Seed a READY meeting: the recording File, a MEETING Page (collectionId null →
 * visible to any workspace member), the MeetingArtifact, three transcript
 * segments, a markdown summary, and two action items. Returns the page id.
 */
async function seedReadyMeeting(userId: string, workspaceId: string): Promise<{ pageId: string }> {
  const recording = await prisma.file.create({
    data: {
      userId,
      workspaceId,
      name: 'standup.mp3',
      ext: 'mp3',
      fileSize: BigInt(74),
      mimeType: 'audio/mpeg',
      hash: `e2e-meeting-${Date.now()}`,
      path: `e2e/meetings/standup-${Date.now()}.mp3`,
      status: 'ACTIVE',
    },
    select: { id: true },
  })

  const page = await prisma.page.create({
    data: {
      workspaceId,
      type: 'MEETING',
      ownership: 'TEXT',
      title: 'Еженедельный синк команды',
      collectionId: null,
      createdById: userId,
    },
    select: { id: true },
  })

  const artifact = await prisma.meetingArtifact.create({
    data: {
      workspaceId,
      pageId: page.id,
      createdById: userId,
      recordingFileId: recording.id,
      title: 'Еженедельный синк команды',
      status: 'READY',
      consentAck: true,
      durationMs: 180_000,
      language: 'ru',
      summary:
        '## Итоги встречи\n\nОбсудили запуск новой функции и распределили задачи между участниками.',
    },
    select: { id: true },
  })

  await prisma.transcriptSegment.createMany({
    data: [
      {
        meetingId: artifact.id,
        idx: 0,
        startMs: 0,
        endMs: 6000,
        speaker: 'Алиса',
        text: 'Привет всем, начнём с обсуждения релиза.',
      },
      {
        meetingId: artifact.id,
        idx: 1,
        startMs: 6000,
        endMs: 14000,
        speaker: 'Борис',
        text: 'Я подготовил демо новой страницы транскрипции встреч.',
      },
      {
        meetingId: artifact.id,
        idx: 2,
        startMs: 14000,
        endMs: 22000,
        speaker: 'Алиса',
        text: 'Отлично, тогда деплой назначим на пятницу.',
      },
    ],
  })

  await prisma.actionItem.createMany({
    data: [
      {
        meetingId: artifact.id,
        idx: 0,
        text: 'Подготовить релизные заметки к пятнице',
        done: false,
      },
      { meetingId: artifact.id, idx: 1, text: 'Назначить деплой на пятницу', done: false },
    ],
  })

  return { pageId: page.id }
}

test.describe('Phase 9E — meetings / transcription', () => {
  test('(a) a READY meeting renders summary + action items + transcript; search filters segments', async ({
    page,
  }) => {
    const { userId, workspaceId } = await signUpAndCreateWorkspace(
      page,
      'meeting-ready',
      'Meetings',
    )
    await enableMeetingsPlan(userId)
    const { pageId } = await seedReadyMeeting(userId, workspaceId)

    // Navigate to the MEETING page. The MeetingTranscriptPage loads the artifact
    // via meeting.getByPage (tRPC, no yjs needed).
    await page.goto(`/pages/${pageId}`)

    const meetingPage = page.getByTestId('meeting-page')
    await expect(meetingPage).toBeVisible({ timeout: 30_000 })

    // Summary (rendered markdown).
    const summary = page.getByTestId('meeting-summary')
    await expect(summary).toContainText('Итоги встречи')
    await expect(summary).toContainText('распределили задачи')

    // Action items.
    const actionItems = page.getByTestId('meeting-action-items')
    await expect(actionItems).toContainText('Подготовить релизные заметки к пятнице')
    await expect(actionItems).toContainText('Назначить деплой на пятницу')

    // Transcript segments (the speaker + text render in the segment list).
    await expect(meetingPage).toContainText('Я подготовил демо новой страницы транскрипции встреч.')
    await expect(meetingPage).toContainText('Алиса')

    // --- Transcript search: a matching query shows a single result; a
    // non-matching one shows the "nothing found" copy. The panel filters the
    // in-memory segments client-side. ---
    const searchBox = page.getByTestId('transcript-search')
    await searchBox.fill('демо')
    const results = page.getByTestId('transcript-search-result')
    await expect(results).toHaveCount(1)
    await expect(results.first()).toContainText('демо новой страницы')

    await searchBox.fill('кибербезопасность')
    await expect(page.getByTestId('transcript-search-result')).toHaveCount(0)
    await expect(page.getByText('Ничего не найдено')).toBeVisible()
  })

  test('(b) the upload dialog: consent checkbox blocks submit until checked', async ({ page }) => {
    const { userId } = await signUpAndCreateWorkspace(page, 'meeting-consent', 'Meetings Consent')
    await enableMeetingsPlan(userId)
    // Re-render the server layout so it picks up the upgraded (meetings-enabled)
    // plan — the upload entry is gated on the workspace owner's plan.
    await page.reload()

    // The «Загрузить встречу» launch entry is visible on a meetings-enabled plan.
    // The sidebar renders one PageTreeSection per collection (Команда / Личное),
    // so the button appears twice — open the dialog from the first.
    const uploadButton = page.getByTestId('upload-meeting-button').first()
    await expect(uploadButton).toBeVisible({ timeout: 30_000 })
    await uploadButton.click()

    // Only the section whose button was clicked opens its dialog (MUI Dialog is
    // unmounted when closed), so scoping the controls to the open dialog keeps
    // the locators single-match even though each section mounts its own dialog.
    const dialog = page.getByTestId('meeting-upload-dialog')
    await expect(dialog).toBeVisible()

    const submit = dialog.getByTestId('meeting-upload-submit')
    const fileInput = dialog.getByTestId('meeting-file-input')
    const consent = dialog.getByTestId('meeting-consent-checkbox')

    // No file, no consent → disabled.
    await expect(submit).toBeDisabled()

    // Pick a recording (a tiny audio fixture) — still disabled because consent is
    // unchecked (consent is the gate this test asserts).
    await fileInput.setInputFiles({
      name: 'standup.mp3',
      mimeType: 'audio/mpeg',
      buffer: Buffer.from('ID3 e2e meeting recording fixture'),
    })
    await expect(submit).toBeDisabled()

    // Check the consent checkbox → submit becomes enabled. (We do NOT click it —
    // completing the real pipeline needs the agents service; the consent gate is
    // the assertion.)
    await consent.check()
    await expect(consent).toBeChecked()
    await expect(submit).toBeEnabled()

    // Unchecking blocks submit again (the gate is two-way).
    await consent.uncheck()
    await expect(submit).toBeDisabled()
  })

  test('(c) plan-off: the «Загрузить встречу» entry is absent without the meetings plan', async ({
    page,
  }) => {
    // A fresh signup is on the `personal` plan (no `meetings` token) → the upload
    // entry must be hidden. We DON'T flip the subscription here.
    await signUpAndCreateWorkspace(page, 'meeting-planoff', 'No Meetings')

    // The start page already shows the sidebar (TEAM/PERSONAL sections). Wait for
    // the «Новая страница» create control so we know the page-tree section has
    // rendered before asserting the meeting entry's absence.
    await expect(page.getByRole('button', { name: 'Новая страница' }).first()).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByTestId('upload-meeting-button')).toHaveCount(0)
  })
})
