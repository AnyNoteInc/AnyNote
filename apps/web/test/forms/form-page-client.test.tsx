// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PublicFormVersion } from '@repo/domain/database/forms'

import { formDraftStorageKey, saveFormDraft } from '@/lib/form-draft-storage'

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  listPickerOptions: vi.fn(),
  executeRecaptcha: vi.fn(),
  setPendingCaptchaToken: vi.fn(),
  refresh: vi.fn(),
  randomUUID: vi.fn(),
}))

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  }
}

vi.mock('@/lib/use-recaptcha-v3', () => ({ useRecaptchaV3: () => mocks.executeRecaptcha }))
vi.mock('@/lib/captcha-token-store', () => ({
  setPendingCaptchaToken: mocks.setPendingCaptchaToken,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('@/trpc/client', () => ({
  trpc: {
    form: { submit: { useMutation: () => ({ mutateAsync: mocks.mutateAsync }) } },
    useUtils: () => ({
      client: { form: { listPickerOptions: { query: mocks.listPickerOptions } } },
    }),
  },
}))
vi.mock('@/components/forms/form-renderer', () => ({
  FormRenderer: (props: {
    initialAnswers: Record<string, unknown>
    onAnswersChange: (answers: Record<string, unknown>) => void
    onReset: () => void
    onSubmit: (values: { answers: Record<string, unknown> }) => Promise<void>
    successEndingId?: string
    onUpload: (questionId: string, file: File) => Promise<{ token: string }>
    onLoadPickerOptions: (questionId: string, query: string) => Promise<{ items: unknown[] }>
  }) => (
    <div>
      <span data-testid="initial-name">{String(props.initialAnswers['name'] ?? '')}</span>
      <span data-testid="ending">{props.successEndingId ?? ''}</span>
      <button type="button" onClick={() => props.onAnswersChange({ name: 'Новый ответ' })}>
        Изменить ответ
      </button>
      <button type="button" onClick={props.onReset}>
        Сбросить
      </button>
      <button
        type="button"
        onClick={() => void props.onSubmit({ answers: { name: 'Новый ответ' } }).catch(() => {})}
      >
        Отправить
      </button>
      <button
        type="button"
        onClick={() => void props.onSubmit({ answers: { name: 'Другой ответ' } }).catch(() => {})}
      >
        Отправить другой
      </button>
      <button
        type="button"
        onClick={() =>
          void props
            .onUpload('file-question', new File(['x'], 'x.txt', { type: 'text/plain' }))
            .then(({ token }) => {
              document.body.dataset.uploadToken = token
            })
            .catch(() => {})
        }
      >
        Загрузить
      </button>
      <button
        type="button"
        onClick={() =>
          void props.onLoadPickerOptions('person-question', 'вик').then(({ items }) => {
            document.body.dataset.optionCount = String(items.length)
          })
        }
      >
        Найти
      </button>
    </div>
  ),
}))

import { FormPageClient, type PublishedFormPayload } from '@/app/(form)/f/[key]/form-page-client'

const version: PublicFormVersion = {
  schemaVersion: 1,
  firstSectionId: 'section',
  presentation: { title: 'Заявка', submitButtonText: 'Отправить', hideAnyNoteBranding: false },
  sections: [{ id: 'section', title: 'Данные', questionIds: ['name'] }],
  questions: [
    {
      id: 'name',
      sectionId: 'section',
      valueType: 'TITLE',
      label: 'Имя',
      required: true,
      syncWithPropertyName: false,
      input: { kind: 'TEXT', multiline: false, maxLength: 200 },
    },
  ],
  transitions: [
    {
      id: 'transition',
      fromSectionId: 'section',
      priority: 0,
      when: null,
      target: { kind: 'ENDING', endingId: 'done' },
    },
  ],
  endings: [{ id: 'done', title: 'Спасибо' }],
}

const published = {
  status: 'OPEN',
  version,
  versionFingerprint: 'fingerprint',
  versionToken: 'signed-version',
  respondentKind: 'anonymous',
} as PublishedFormPayload

describe('FormPageClient', () => {
  beforeEach(() => {
    const storage = memoryStorage()
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
    vi.stubGlobal('localStorage', storage)
    delete document.body.dataset.uploadToken
    delete document.body.dataset.optionCount
    mocks.mutateAsync.mockReset().mockResolvedValue({ endingId: 'done' })
    mocks.listPickerOptions
      .mockReset()
      .mockResolvedValue({ items: [{ id: 'u1', label: 'Виктор' }] })
    mocks.executeRecaptcha.mockReset().mockResolvedValue('captcha-token')
    mocks.setPendingCaptchaToken.mockReset()
    mocks.refresh.mockReset()
    mocks.randomUUID
      .mockReset()
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValue('22222222-2222-4222-8222-222222222222')
    vi.stubGlobal('crypto', { randomUUID: mocks.randomUUID })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('restores, updates and explicitly clears the version-scoped local draft', async () => {
    const actor = userEvent.setup()
    const key = formDraftStorageKey('anf_public', 'fingerprint')
    saveFormDraft(localStorage, key, { name: 'Черновик' })
    render(<FormPageClient locator="anf_public" published={published} />)

    expect(await screen.findByTestId('initial-name')).toHaveTextContent('Черновик')
    await actor.click(screen.getByRole('button', { name: 'Изменить ответ' }))
    expect(JSON.parse(localStorage.getItem(key) ?? '{}')).toMatchObject({
      answers: { name: 'Новый ответ' },
    })
    await actor.click(screen.getByRole('button', { name: 'Сбросить' }))
    expect(localStorage.getItem(key)).toBeNull()
  })

  it('submits with CAPTCHA and a stable idempotency key, then clears the draft', async () => {
    const actor = userEvent.setup()
    const key = formDraftStorageKey('anf_public', 'fingerprint')
    saveFormDraft(localStorage, key, { name: 'Черновик' })
    render(<FormPageClient locator="anf_public" published={published} />)
    await screen.findByTestId('initial-name')

    await actor.click(screen.getByRole('button', { name: 'Отправить' }))

    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledOnce())
    expect(mocks.executeRecaptcha).toHaveBeenCalledWith('form_submit')
    expect(mocks.setPendingCaptchaToken).toHaveBeenCalledWith('captcha-token')
    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      locator: 'anf_public',
      versionToken: 'signed-version',
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      answers: { name: 'Новый ответ' },
      honeypot: '',
    })
    expect(localStorage.getItem(key)).toBeNull()
    expect(screen.getByTestId('ending')).toHaveTextContent('done')
  })

  it('uses the upload CAPTCHA action and public picker API', async () => {
    const actor = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          uploadToken: 'lease-token',
          file: {
            name: 'x.txt',
            mimeType: 'text/plain',
            fileSize: '1',
            expiresAt: '2026-07-17T12:00:00.000Z',
          },
        }),
      ),
    )
    render(<FormPageClient locator="anf_public" published={published} />)
    await screen.findByTestId('initial-name')

    await actor.click(screen.getByRole('button', { name: 'Загрузить' }))
    await waitFor(() => expect(document.body.dataset.uploadToken).toBe('lease-token'))
    expect(mocks.executeRecaptcha).toHaveBeenCalledWith('form_upload')
    expect(fetch).toHaveBeenCalledWith(
      '/api/forms/anf_public/uploads',
      expect.objectContaining({
        method: 'POST',
        headers: { 'x-captcha-response': 'captcha-token' },
      }),
    )

    await actor.click(screen.getByRole('button', { name: 'Найти' }))
    await waitFor(() => expect(document.body.dataset.optionCount).toBe('1'))
    expect(mocks.listPickerOptions).toHaveBeenCalledWith({
      locator: 'anf_public',
      versionToken: 'signed-version',
      questionId: 'person-question',
      query: 'вик',
      cursor: undefined,
      limit: 50,
    })
  })

  it('reuses an idempotency key only when retrying the same payload', async () => {
    const actor = userEvent.setup()
    mocks.mutateAsync.mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce({
      endingId: 'done',
    })
    render(<FormPageClient locator="anf_public" published={published} />)
    await screen.findByTestId('initial-name')

    await actor.click(screen.getByRole('button', { name: /^Отправить$/ }))
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(1))
    await actor.click(screen.getByRole('button', { name: /^Отправить$/ }))
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(2))

    expect(mocks.mutateAsync.mock.calls[0]?.[0].idempotencyKey).toBe(
      '11111111-1111-4111-8111-111111111111',
    )
    expect(mocks.mutateAsync.mock.calls[1]?.[0].idempotencyKey).toBe(
      '11111111-1111-4111-8111-111111111111',
    )
  })

  it('starts a new idempotent attempt when answers change after transport uncertainty', async () => {
    const actor = userEvent.setup()
    mocks.mutateAsync.mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce({
      endingId: 'done',
    })
    render(<FormPageClient locator="anf_public" published={published} />)
    await screen.findByTestId('initial-name')

    await actor.click(screen.getByRole('button', { name: /^Отправить$/ }))
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(1))
    await actor.click(screen.getByRole('button', { name: 'Отправить другой' }))
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(2))

    expect(mocks.mutateAsync.mock.calls[1]?.[0]).toMatchObject({
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
      answers: { name: 'Другой ответ' },
    })
  })

  it.each([
    ['FORM_VERSION_STALE', 'Форма обновилась'],
    ['FORM_NOT_ACCEPTING', 'Форма больше не принимает ответы'],
  ])('refreshes after the domain race %s', async (message, expectedCopy) => {
    const actor = userEvent.setup()
    mocks.mutateAsync.mockRejectedValue({ data: { code: 'CONFLICT' }, message })
    render(<FormPageClient locator="anf_public" published={published} />)
    await screen.findByTestId('initial-name')

    await actor.click(screen.getByRole('button', { name: /^Отправить$/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent(expectedCopy)
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })

  it('shows a fail-closed protection error when CAPTCHA rejects submit or upload', async () => {
    const actor = userEvent.setup()
    mocks.executeRecaptcha.mockRejectedValue(new Error('provider unavailable'))
    render(<FormPageClient locator="anf_public" published={published} />)
    await screen.findByTestId('initial-name')

    await actor.click(screen.getByRole('button', { name: /^Отправить$/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось запустить защиту формы')

    await actor.click(screen.getByRole('button', { name: 'Загрузить' }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Не удалось запустить защиту формы'),
    )
    expect(mocks.mutateAsync).not.toHaveBeenCalled()
  })
})
