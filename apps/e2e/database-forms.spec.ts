import { createHash, createHmac, randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

import type { FormVersionDocument } from '@repo/domain/database/forms'

import { loadEnvFromRoot, writeConsentsForUserId } from './helpers/auth'

const BASE_URL = 'http://localhost:3100'
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

let prisma: typeof import('../../packages/db/src/index').prisma
let workspaceId = ''
let memberUserId = ''
let ownerEmail = ''

async function createOwnerAndAuthenticate(page: Page, email: string): Promise<void> {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error('BETTER_AUTH_SECRET is required for E2E sessions')
  const personalPlan = await prisma.plan.findUniqueOrThrow({ where: { slug: 'personal' } })
  const token = randomUUID()
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        name: 'Forms Owner',
        firstName: 'Forms',
        lastName: 'Owner',
        emailVerified: true,
      },
    })
    await tx.subscription.create({
      data: { userId: created.id, planId: personalPlan.id, status: 'ACTIVE' },
    })
    await tx.userPreference.create({ data: { userId: created.id } })
    await tx.session.create({
      data: {
        token,
        userId: created.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
        ipAddress: '127.0.0.1',
        userAgent: 'playwright',
      },
    })
    return created
  })
  await writeConsentsForUserId(user.id)
  const sessionToken = `${token}.${createHmac('sha256', secret).update(token).digest('base64')}`
  await page.context().addCookies([
    {
      name: 'better-auth.session_token',
      value: sessionToken,
      url: BASE_URL,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
  await page.goto(`${BASE_URL}/app`)
  await expect(page.getByRole('heading', { name: 'Создайте рабочее пространство' })).toBeVisible({
    timeout: 20_000,
  })
}

async function createWorkspaceAndDatabasePage(page: Page): Promise<string> {
  await page.getByRole('textbox', { name: 'Название' }).fill(`Forms E2E ${RUN}`)
  const create = page.getByRole('button', { name: 'Создать пространство' })
  await expect(create).toBeEnabled({ timeout: 20_000 })
  await create.click()
  await expect
    .poll(
      () =>
        prisma.workspace.count({
          where: { createdBy: { email: ownerEmail }, name: `Forms E2E ${RUN}` },
        }),
      { timeout: 30_000 },
    )
    .toBe(1)
  // NewWorkspaceForm pushes to /app while already on /app, so force a fresh
  // server render after the mutation has established the active workspace.
  await page.goto(`${BASE_URL}/app`)
  await page.waitForURL(/\/(pages|chats)\//, { timeout: 30_000 })
  const previousUrl = page.url()

  await page.getByRole('button', { name: 'Новая страница' }).first().click()
  const createDatabase = page.getByRole('button', { name: 'Создать страницу: База данных' })
  await expect(createDatabase).toBeEnabled()
  await Promise.all([
    page.waitForURL((url) => /\/pages\/[a-f0-9-]+/.test(url.href) && url.href !== previousUrl, {
      timeout: 20_000,
    }),
    createDatabase.click(),
  ])
  await expect(page.getByRole('dialog', { name: /Создание страницы/ })).toHaveCount(0)
  await expect(page.getByRole('columnheader', { name: 'Название' })).toBeVisible({
    timeout: 20_000,
  })

  const pageId = /\/pages\/([a-f0-9-]+)/.exec(page.url())?.[1]
  if (!pageId) throw new Error(`Database page id is missing from ${page.url()}`)
  return pageId
}

async function submitPublicFormThroughBrowser(args: {
  page: Page
  locator: string
  title: string
  endingTitle: string
}): Promise<void> {
  await args.page.goto(`${BASE_URL}/f/${args.locator}`)
  await expect(args.page.getByRole('heading', { name: /Форма|Маршрутная форма/ })).toBeVisible({
    timeout: 20_000,
  })
  await args.page.getByRole('textbox').first().fill(args.title)

  const ending = args.page.getByRole('heading', { name: args.endingTitle })
  const next = args.page.getByRole('button', { name: 'Далее' })
  const submit = args.page.getByRole('button', { name: 'Отправить' })
  await expect(next.or(submit)).toBeVisible({ timeout: 20_000 })
  if (await next.isVisible()) await next.click()
  await expect(submit.or(ending)).toBeVisible({ timeout: 20_000 })
  if (await submit.isVisible()) await submit.click()
  await expect(ending).toBeVisible({ timeout: 20_000 })
}

function branchDocument(): FormVersionDocument {
  return {
    schemaVersion: 1,
    firstSectionId: 'branch-section',
    presentation: {
      title: 'Маршрутная форма',
      description: 'Вторая форма пишет в ту же базу',
      submitButtonText: 'Отправить',
      hideAnyNoteBranding: false,
    },
    sections: [{ id: 'branch-section', title: 'Выбор маршрута', questionIds: ['branch-title'] }],
    questions: [
      {
        id: 'branch-title',
        sectionId: 'branch-section',
        property: { kind: 'TITLE' },
        label: 'Код маршрута',
        required: true,
        syncWithPropertyName: false,
        input: { kind: 'TEXT', multiline: false, maxLength: 200 },
      },
    ],
    transitions: [
      {
        id: 'vip-transition',
        fromSectionId: 'branch-section',
        priority: 0,
        when: {
          kind: 'ALL',
          members: [{ kind: 'TEXT_EQUALS', questionId: 'branch-title', value: 'vip' }],
        },
        target: { kind: 'ENDING', endingId: 'vip-ending' },
      },
      {
        id: 'regular-transition',
        fromSectionId: 'branch-section',
        priority: 1,
        when: null,
        target: { kind: 'ENDING', endingId: 'regular-ending' },
      },
    ],
    endings: [
      { id: 'vip-ending', title: 'VIP маршрут' },
      { id: 'regular-ending', title: 'Обычный маршрут' },
    ],
  }
}

test.beforeAll(async () => {
  loadEnvFromRoot()
  prisma = (await import('../../packages/db/src/index')).prisma
})

test.afterAll(async () => {
  if (workspaceId) {
    await prisma.workspace.deleteMany({ where: { id: workspaceId } }).catch(() => undefined)
  }
  if (ownerEmail) {
    const identities = [{ email: ownerEmail }, ...(memberUserId ? [{ id: memberUserId }] : [])]
    await prisma.user.deleteMany({ where: { OR: identities } }).catch(() => undefined)
  }
  await prisma.$disconnect()
})

test('database forms: owner lifecycle, isolated responses, audiences and responsive public UI', async ({
  browser,
  page,
}) => {
  test.setTimeout(300_000)
  ownerEmail = `database-forms+${RUN}@example.com`

  await test.step('owner creates, extends, previews and publishes a form', async () => {
    await createOwnerAndAuthenticate(page, ownerEmail)
    const pageId = await createWorkspaceAndDatabasePage(page)
    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: ownerEmail },
      select: { id: true },
    })
    const workspace = await prisma.workspace.findFirstOrThrow({
      where: { createdById: owner.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    workspaceId = workspace.id

    await page.getByRole('button', { name: 'Добавить представление' }).click()
    await page.getByRole('menuitem', { name: 'Форма', exact: true }).click()
    const outline = page.getByLabel('Структура формы')
    await expect(outline).toBeVisible({ timeout: 20_000 })

    await outline.getByRole('button', { name: 'Добавить раздел' }).click()
    await expect(outline.getByText(/2 раздела · 1 вопросов/)).toBeVisible()
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible({ timeout: 20_000 })
    await outline.getByRole('button', { name: 'Вопрос', exact: true }).last().click()
    const picker = page.getByRole('dialog', { name: 'Добавить вопрос' })
    await expect(picker).toBeVisible()
    await picker.getByRole('button', { name: /^Статус/ }).click()
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible({ timeout: 20_000 })

    // A newly added section is intentionally not wired into the graph. Route
    // the default transition from the first section into it before publishing.
    await outline.getByRole('button', { name: /^Вопросы/ }).click()
    await page.getByLabel('Перейти к').click()
    await page.getByRole('option', { name: 'Новый раздел' }).click()
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/Публикация недоступна:/)).toHaveCount(0)

    await expect
      .poll(
        async () => {
          const form = await prisma.databaseForm.findFirst({
            where: { source: { pageId } },
            orderBy: { createdAt: 'desc' },
          })
          const draft = form?.draftSchema as
            { sections?: unknown[]; questions?: unknown[] } | undefined
          return {
            sections: draft?.sections?.length ?? 0,
            questions: draft?.questions?.length ?? 0,
            firstTarget:
              (draft as { transitions?: Array<{ target?: { kind?: string } }> } | undefined)
                ?.transitions?.[0]?.target?.kind ?? null,
          }
        },
        { timeout: 20_000 },
      )
      .toEqual({ sections: 2, questions: 2, firstTarget: 'SECTION' })

    await page.getByRole('button', { name: 'Предпросмотр', exact: true }).click()
    const preview = page.getByRole('dialog', { name: 'Предпросмотр' })
    await expect(preview.getByRole('heading', { name: 'Форма' })).toBeVisible()
    await expect(preview.getByText('Новый раздел', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')

    const publish = page.getByRole('button', { name: 'Опубликовать' })
    await expect(publish).toBeEnabled({ timeout: 20_000 })
    await publish.click()
    await expect
      .poll(
        async () =>
          (
            await prisma.databaseForm.findFirstOrThrow({
              where: { source: { pageId } },
              select: { publishedVersionId: true },
            })
          ).publishedVersionId,
        { timeout: 20_000 },
      )
      .not.toBeNull()

    const current = await prisma.databaseForm.findFirstOrThrow({
      where: { source: { pageId } },
      include: { source: true, publishedVersion: true, view: true },
    })
    expect(current.publishedVersion).not.toBeNull()
    expect(current.view?.type).toBe('FORM')
  })

  const owner = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } })
  const source = await prisma.databaseSource.findFirstOrThrow({ where: { workspaceId } })
  const primaryForm = await prisma.databaseForm.findFirstOrThrow({
    where: { sourceId: source.id },
    include: { publishedVersion: true, view: true },
    orderBy: { createdAt: 'asc' },
  })
  const oldGeneratedKey = primaryForm.routeKey
  const primaryDocument = primaryForm.publishedVersion?.schema as
    { endings?: Array<{ id: string; title: string }> } | undefined
  const primaryEndingTitle = primaryDocument?.endings?.find(({ id }) => id === 'ending-1')?.title
  if (!primaryEndingTitle) throw new Error('Published E2E ending is missing')

  await test.step('personal plan exposes the form but gates premium controls', async () => {
    await page.getByRole('button', { name: 'Поделиться' }).last().click()
    const share = page.getByRole('dialog', { name: 'Публикация и доступ' })
    await expect(share.getByLabel('Свой адрес')).toBeDisabled()
    await expect(share.getByLabel('Скрыть брендинг AnyNote')).toBeDisabled()
    await expect(share.getByText('Разветвлённые маршруты доступны на старшем плане.')).toBeVisible()
    await share.getByRole('button', { name: 'Готово' }).click()
  })

  const anonymousContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const anonymous = await anonymousContext.newPage()

  await test.step('generated key renders the desktop A2 section map and mobile progress', async () => {
    await anonymous.goto(`${BASE_URL}/f/${oldGeneratedKey}`)
    await expect(anonymous.getByRole('heading', { name: 'Форма' })).toBeVisible({ timeout: 20_000 })
    await expect(anonymous.getByText('Маршрут', { exact: true })).toBeVisible()
    await expect(anonymous.getByRole('button', { name: 'Новый раздел' })).toBeVisible()

    await anonymous.setViewportSize({ width: 390, height: 844 })
    await anonymous.goto(`${BASE_URL}/f/${oldGeneratedKey}`)
    await expect(anonymous.getByLabel(/Прогресс формы:/)).toBeVisible()
    await expect(anonymous.getByText('Маршрут', { exact: true })).toBeHidden()
    expect(
      await anonymous.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true)
    await anonymous.setViewportSize({ width: 1280, height: 800 })
  })

  await test.step('anonymous respondent submits through the public browser form', async () => {
    const before = await prisma.databaseFormSubmission.count({ where: { formId: primaryForm.id } })
    await submitPublicFormThroughBrowser({
      page: anonymous,
      locator: oldGeneratedKey,
      title: 'Anonymous primary',
      endingTitle: primaryEndingTitle,
    })
    await expect
      .poll(() => prisma.databaseFormSubmission.count({ where: { formId: primaryForm.id } }))
      .toBe(before + 1)
  })

  const persistedAnonymous = await prisma.databaseFormSubmission.findUniqueOrThrow({
    where: {
      id: (
        await prisma.databaseFormSubmission.findFirstOrThrow({
          where: { formId: primaryForm.id },
          orderBy: { submittedAt: 'desc' },
          select: { id: true },
        })
      ).id,
    },
    include: { row: { include: { page: true } } },
  })
  expect(persistedAnonymous).toMatchObject({
    formId: primaryForm.id,
    endingId: 'ending-1',
    respondentUserId: null,
    row: { createdById: null, page: { title: 'Anonymous primary', createdById: null } },
  })

  let branchFormId = ''
  await test.step('two forms share a source while deriving isolated branch endings', async () => {
    const view = await prisma.databaseView.create({
      data: { sourceId: source.id, type: 'FORM', title: 'Маршрутная форма', position: 9_000 },
    })
    const schema = branchDocument()
    const branch = await prisma.databaseForm.create({
      data: {
        sourceId: source.id,
        viewId: view.id,
        routeKey: `anf_e2e_${RUN.replaceAll('-', '_')}`.slice(0, 64),
        draftSchema: schema,
        state: 'OPEN',
        audience: 'ANYONE_WITH_LINK',
        notifyOwners: false,
        createdById: owner.id,
      },
    })
    branchFormId = branch.id
    const version = await prisma.databaseFormVersion.create({
      data: {
        formId: branch.id,
        versionNumber: 1,
        schema,
        schemaHash: createHash('sha256').update(JSON.stringify(schema)).digest('hex'),
        publishedById: owner.id,
      },
    })
    await prisma.databaseForm.update({
      where: { id: branch.id },
      data: { publishedVersionId: version.id },
    })

    await submitPublicFormThroughBrowser({
      page: anonymous,
      locator: branch.routeKey,
      title: 'vip',
      endingTitle: 'VIP маршрут',
    })
    await submitPublicFormThroughBrowser({
      page: anonymous,
      locator: branch.routeKey,
      title: 'regular',
      endingTitle: 'Обычный маршрут',
    })
    await expect
      .poll(() => prisma.databaseFormSubmission.count({ where: { formId: branch.id } }))
      .toBe(2)
    await expect(
      prisma.databaseFormSubmission.findMany({
        where: { formId: branch.id },
        orderBy: { submittedAt: 'asc' },
        select: { endingId: true, row: { select: { page: { select: { title: true } } } } },
      }),
    ).resolves.toEqual([
      { endingId: 'vip-ending', row: { page: { title: 'vip' } } },
      { endingId: 'regular-ending', row: { page: { title: 'regular' } } },
    ])
    expect(await prisma.databaseFormSubmission.count({ where: { formId: primaryForm.id } })).toBe(1)
  })

  let customSlug = ''
  let rotatedKey = ''
  await test.step('feature flags unlock slug/branding, then slug and key rotation take effect', async () => {
    const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
    await prisma.subscription.updateMany({
      where: { userId: owner.id, status: 'ACTIVE' },
      data: { planId: pro.id },
    })
    await page.reload()
    await expect(page.getByLabel('Структура формы')).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Поделиться' }).last().click()
    const share = page.getByRole('dialog', { name: 'Публикация и доступ' })
    await expect(share.getByLabel('Свой адрес')).toBeEnabled()
    await expect(share.getByLabel('Скрыть брендинг AnyNote')).toBeEnabled()
    await expect(share.getByText('Разветвлённые маршруты доступны на старшем плане.')).toHaveCount(
      0,
    )

    customSlug = `survey-${RUN}`
      .toLowerCase()
      .replaceAll(/[^a-z0-9-]/g, '')
      .slice(0, 60)
    await share.getByLabel('Свой адрес').fill(customSlug)
    await share.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect
      .poll(
        async () =>
          (await prisma.databaseForm.findUniqueOrThrow({ where: { id: primaryForm.id } }))
            .customSlug,
      )
      .toBe(customSlug)

    await share.getByRole('button', { name: 'Сменить секретную ссылку' }).click()
    const rotate = page.getByRole('dialog', { name: 'Сменить ссылку?' })
    await rotate.getByRole('button', { name: 'Сменить', exact: true }).click()
    await expect
      .poll(
        async () =>
          (await prisma.databaseForm.findUniqueOrThrow({ where: { id: primaryForm.id } })).routeKey,
      )
      .not.toBe(oldGeneratedKey)
    rotatedKey = (await prisma.databaseForm.findUniqueOrThrow({ where: { id: primaryForm.id } }))
      .routeKey
    await share.getByRole('button', { name: 'Готово' }).click()

    await anonymous.goto(`${BASE_URL}/f/${oldGeneratedKey}`)
    await expect(anonymous.getByRole('heading', { name: 'Форма недоступна' })).toBeVisible()
    await anonymous.goto(`${BASE_URL}/f/${rotatedKey}`)
    await expect(anonymous.getByRole('heading', { name: 'Форма' })).toBeVisible()
    await anonymous.goto(`${BASE_URL}/f/${customSlug}`)
    await expect(anonymous.getByRole('heading', { name: 'Форма' })).toBeVisible()
  })

  await test.step('schedule, close/reopen and cap produce their dedicated public states', async () => {
    await prisma.databaseForm.update({
      where: { id: primaryForm.id },
      data: { opensAt: new Date(Date.now() + 86_400_000) },
    })
    await anonymous.goto(`${BASE_URL}/f/${customSlug}`)
    await expect(anonymous.getByRole('heading', { name: 'Форма откроется позже' })).toBeVisible()
    await prisma.databaseForm.update({ where: { id: primaryForm.id }, data: { opensAt: null } })

    await page.getByRole('button', { name: 'Поделиться' }).last().click()
    let share = page.getByRole('dialog', { name: 'Публикация и доступ' })
    await share.getByRole('button', { name: 'Закрыть форму' }).click()
    await expect
      .poll(
        async () =>
          (await prisma.databaseForm.findUniqueOrThrow({ where: { id: primaryForm.id } })).state,
      )
      .toBe('CLOSED')
    await anonymous.goto(`${BASE_URL}/f/${customSlug}`)
    await expect(anonymous.getByRole('heading', { name: 'Приём ответов завершён' })).toBeVisible()

    await share.getByRole('button', { name: 'Открыть форму' }).click()
    await expect
      .poll(
        async () =>
          (await prisma.databaseForm.findUniqueOrThrow({ where: { id: primaryForm.id } })).state,
      )
      .toBe('OPEN')
    await share.getByRole('button', { name: 'Готово' }).click()

    const current = await prisma.databaseForm.findUniqueOrThrow({ where: { id: primaryForm.id } })
    await prisma.databaseForm.update({
      where: { id: primaryForm.id },
      data: { responseLimit: current.acceptedResponses },
    })
    await anonymous.goto(`${BASE_URL}/f/${customSlug}`)
    await expect(anonymous.getByRole('heading', { name: 'Лимит ответов достигнут' })).toBeVisible()
    await prisma.databaseForm.update({
      where: { id: primaryForm.id },
      data: { responseLimit: null },
    })
  })

  let ownerSubmissionId = ''
  let memberSubmissionId = ''
  await test.step('signed-in/workspace audiences capture identity and isolate own responses', async () => {
    await prisma.databaseForm.update({
      where: { id: primaryForm.id },
      data: { audience: 'SIGNED_IN_WITH_LINK', respondentAccess: 'VIEW' },
    })
    await submitPublicFormThroughBrowser({
      page,
      locator: customSlug,
      title: 'Owner signed-in response',
      endingTitle: primaryEndingTitle,
    })
    await expect(page.getByRole('link', { name: 'Посмотреть свой ответ' })).toBeVisible()
    const ownerSubmission = await prisma.databaseFormSubmission.findFirstOrThrow({
      where: { formId: primaryForm.id, respondentUserId: owner.id },
      orderBy: { submittedAt: 'desc' },
    })
    ownerSubmissionId = ownerSubmission.id

    const memberEmail = `database-forms-member+${RUN}@example.com`
    const memberContext = await browser.newContext()
    const memberPage = await memberContext.newPage()
    await createOwnerAndAuthenticate(memberPage, memberEmail)
    const member = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } })
    memberUserId = member.id
    await prisma.workspaceMember.create({
      data: { workspaceId, userId: member.id, role: 'EDITOR' },
    })
    await prisma.databaseForm.update({
      where: { id: primaryForm.id },
      data: { audience: 'WORKSPACE_MEMBERS_WITH_LINK', respondentAccess: 'EDIT' },
    })
    await submitPublicFormThroughBrowser({
      page: memberPage,
      locator: customSlug,
      title: 'Member workspace response',
      endingTitle: primaryEndingTitle,
    })
    await expect(memberPage.getByRole('link', { name: 'Посмотреть свой ответ' })).toBeVisible()
    const memberSubmission = await prisma.databaseFormSubmission.findFirstOrThrow({
      where: { formId: primaryForm.id, respondentUserId: member.id },
      orderBy: { submittedAt: 'desc' },
    })
    memberSubmissionId = memberSubmission.id
    await expect(
      prisma.databaseFormSubmission.findUniqueOrThrow({ where: { id: memberSubmissionId } }),
    ).resolves.toMatchObject({ respondentUserId: member.id })

    await anonymous.goto(`${BASE_URL}/f/${customSlug}`)
    await expect(
      anonymous.getByRole('heading', { name: 'Форма доступна после входа' }),
    ).toBeVisible()

    await page.goto(`${BASE_URL}/f/${customSlug}/responses/${ownerSubmissionId}`)
    await expect(page.getByRole('heading', { name: 'Форма' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('textbox', { name: /Название/ })).toHaveValue(
      'Owner signed-in response',
    )
    await page.getByRole('button', { name: 'Далее' }).click()
    await expect(page.getByRole('heading', { name: 'Новый раздел' })).toBeVisible({
      timeout: 20_000,
    })

    const editableBranch = await prisma.databaseForm.update({
      where: { id: branchFormId },
      data: { audience: 'SIGNED_IN_WITH_LINK', respondentAccess: 'EDIT' },
    })
    await submitPublicFormThroughBrowser({
      page,
      locator: editableBranch.routeKey,
      title: 'Owner editable branch response',
      endingTitle: 'Обычный маршрут',
    })
    const editableSubmission = await prisma.databaseFormSubmission.findFirstOrThrow({
      where: { formId: branchFormId, respondentUserId: owner.id },
      orderBy: { submittedAt: 'desc' },
    })
    await page.goto(`${BASE_URL}/f/${editableBranch.routeKey}/responses/${editableSubmission.id}`)
    await expect(page.getByRole('textbox', { name: /Код маршрута/ })).toHaveValue(
      'Owner editable branch response',
    )
    await page.getByRole('textbox', { name: /Код маршрута/ }).fill('Owner branch edited')
    const save = page.getByRole('button', { name: 'Сохранить изменения' })
    const saved = page.getByRole('status').filter({ hasText: 'Изменения сохранены' })
    await expect(save).toBeVisible({ timeout: 20_000 })
    await save.click()
    await expect(saved).toBeVisible({ timeout: 20_000 })
    await expect
      .poll(async () => {
        const submission = await prisma.databaseFormSubmission.findUniqueOrThrow({
          where: { id: editableSubmission.id },
          select: { row: { select: { page: { select: { title: true } } } } },
        })
        return submission.row.page.title
      })
      .toBe('Owner branch edited')

    const forbidden = await page.goto(`${BASE_URL}/f/${customSlug}/responses/${memberSubmissionId}`)
    expect(forbidden?.status()).toBe(404)
    await memberContext.close()
  })

  await test.step('owner response list remains scoped to its form', async () => {
    const formViewUrl = `${BASE_URL}/pages/${source.pageId}?viewId=${primaryForm.viewId}`
    await page.goto(formViewUrl)
    await expect(page.getByLabel('Структура формы')).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: /Ответы/ }).click()
    const responses = page.getByRole('dialog', { name: 'Ответы формы' })
    await expect(responses.getByText('Anonymous primary', { exact: true })).toBeVisible()
    await expect(responses.getByText('Owner signed-in response', { exact: true })).toBeVisible()
    await expect(responses.getByText('Member workspace response', { exact: true })).toBeVisible()
    await expect(responses.getByText('vip', { exact: true })).toHaveCount(0)
    await expect(responses.getByText('regular', { exact: true })).toHaveCount(0)
    await expect(responses.getByText('Owner branch edited', { exact: true })).toHaveCount(0)
    expect(await prisma.databaseFormSubmission.count({ where: { formId: branchFormId } })).toBe(3)
  })

  await anonymousContext.close()
})
