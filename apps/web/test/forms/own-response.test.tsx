// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  picker: vi.fn(),
  getOwnResponse: vi.fn(),
  invalidate: vi.fn(),
  executeRecaptcha: vi.fn(),
  refresh: vi.fn(),
  requireSession: vi.fn(),
  serverGetOwnResponse: vi.fn(),
  getServerTRPC: vi.fn(),
  notFound: vi.fn(),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

vi.mock('@/lib/use-recaptcha-v3', () => ({ useRecaptchaV3: () => mocks.executeRecaptcha }))
vi.mock('@/lib/get-session', () => ({ requireSession: mocks.requireSession }))
vi.mock('@/trpc/server', () => ({ getServerTRPC: mocks.getServerTRPC }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
  notFound: mocks.notFound,
}))
vi.mock('@/trpc/client', () => ({
  trpc: {
    form: { updateOwnResponse: { useMutation: () => ({ mutateAsync: mocks.update }) } },
    useUtils: () => ({
      form: { getOwnResponse: { invalidate: mocks.invalidate } },
      client: {
        form: {
          getOwnResponse: { query: mocks.getOwnResponse },
          listOwnResponsePickerOptions: { query: mocks.picker },
        },
      },
    }),
  },
}))
vi.mock('@/components/forms/form-renderer', () => ({
  FormRenderer: (props: {
    readOnly?: boolean
    initialAnswers: Record<string, unknown>
    initialFileNames?: Record<string, string>
    initialPickerOptions?: Record<string, { id: string; label: string }[]>
    submissionDisabled?: boolean
    unavailableQuestionIds?: string[]
    onSubmit?: (value: { answers: Record<string, unknown> }) => Promise<void>
    onAnswersChange?: (answers: Record<string, unknown>) => void
    onUpload?: (questionId: string, file: File) => Promise<{ token: string }>
    onLoadPickerOptions?: (questionId: string, query: string) => Promise<{ items: unknown[] }>
  }) => (
    <div>
      <span data-testid="mode">{props.readOnly ? 'VIEW' : 'EDIT'}</span>
      <span data-testid="name">{String(props.initialAnswers['name'] ?? '')}</span>
      <span data-testid="file-name">{props.initialFileNames?.['retained-handle'] ?? ''}</span>
      <span data-testid="picker-label">
        {props.initialPickerOptions?.['person']?.[0]?.label ?? ''}
      </span>
      <span data-testid="unavailable">{props.unavailableQuestionIds?.join(',') ?? ''}</span>
      {props.onSubmit ? (
        <>
          <button
            type="button"
            disabled={props.submissionDisabled}
            onClick={() =>
              void props.onSubmit?.({ answers: { name: 'Новое имя' } }).catch(() => {})
            }
          >
            Сохранить
          </button>
          <button
            type="button"
            disabled={props.submissionDisabled}
            onClick={() => props.onAnswersChange?.({ name: 'Правка после предупреждения' })}
          >
            Изменить после предупреждения
          </button>
        </>
      ) : null}
      {props.onUpload ? (
        <button
          type="button"
          onClick={() =>
            void props
              .onUpload?.('file', new File(['x'], 'new.txt', { type: 'text/plain' }))
              .then(({ token }) => {
                document.body.dataset.ownUpload = token
              })
          }
        >
          Загрузить
        </button>
      ) : null}
      {props.onLoadPickerOptions ? (
        <button
          type="button"
          onClick={() =>
            void props.onLoadPickerOptions?.('person', 'вик').then(({ items }) => {
              document.body.dataset.ownPicker = String(items.length)
            })
          }
        >
          Найти
        </button>
      ) : null}
    </div>
  ),
}))

import {
  OwnResponseClient,
  type OwnResponsePayload,
} from '@/app/(form)/f/[key]/responses/[submissionId]/own-response-client'
import OwnResponsePage from '@/app/(form)/f/[key]/responses/[submissionId]/page'

const version = {
  schemaVersion: 1,
  firstSectionId: 'section',
  presentation: { title: 'Заявка', submitButtonText: 'Отправить', hideAnyNoteBranding: false },
  sections: [{ id: 'section', title: 'Данные', questionIds: ['name', 'file', 'person', 'old'] }],
  questions: [
    {
      id: 'name',
      sectionId: 'section',
      valueType: 'TITLE',
      label: 'Имя',
      required: true,
      syncWithPropertyName: false,
      input: { kind: 'TEXT', multiline: false, maxLength: 200 },
      available: true,
    },
    {
      id: 'file',
      sectionId: 'section',
      valueType: 'FILE',
      label: 'Файл',
      required: false,
      syncWithPropertyName: false,
      input: { kind: 'FILE', allowedMimeTypes: [], maxBytesPerFile: 1000, maxFiles: 2 },
      available: true,
    },
    {
      id: 'person',
      sectionId: 'section',
      valueType: 'PERSON',
      label: 'Участник',
      required: false,
      syncWithPropertyName: false,
      input: { kind: 'PERSON', maxSelections: 2 },
      available: true,
    },
    {
      id: 'old',
      sectionId: 'section',
      valueType: 'TEXT',
      label: 'Удалённое поле',
      required: false,
      syncWithPropertyName: false,
      input: { kind: 'TEXT', multiline: false, maxLength: 200 },
      available: false,
    },
  ],
  transitions: [
    {
      id: 'done-transition',
      fromSectionId: 'section',
      priority: 0,
      when: null,
      target: { kind: 'ENDING', endingId: 'done' },
    },
  ],
  endings: [{ id: 'done', title: 'Готово' }],
}

function payload(status: 'VIEW' | 'EDIT' = 'EDIT'): OwnResponsePayload {
  return {
    status,
    revision: 'a'.repeat(64),
    versionNumber: 1,
    versionFingerprint: 'b'.repeat(64),
    version,
    answers: { name: 'Старое имя', file: ['retained-handle'] },
    files: {
      file: [
        { handle: 'retained-handle', name: 'contract.pdf', mimeType: 'application/pdf', size: 12 },
      ],
    },
    selectedOptions: {
      person: [{ value: 'opaque-person', label: 'Виктор Иванов' }],
    },
    questionTokens: { file: 'upload-context', person: 'picker-context' },
  } as OwnResponsePayload
}

describe('OwnResponseClient', () => {
  beforeEach(() => {
    delete document.body.dataset.ownUpload
    delete document.body.dataset.ownPicker
    mocks.update.mockReset()
    mocks.picker.mockReset().mockResolvedValue({ items: [{ id: 'u1', label: 'Виктор' }] })
    mocks.getOwnResponse.mockReset().mockImplementation(async () => payload())
    mocks.invalidate.mockReset().mockResolvedValue(undefined)
    mocks.executeRecaptcha.mockReset().mockResolvedValue('captcha-token')
    mocks.refresh.mockReset()
    mocks.requireSession.mockReset().mockResolvedValue({ user: { id: 'respondent' } })
    mocks.serverGetOwnResponse.mockReset().mockImplementation(async () => payload())
    mocks.getServerTRPC.mockReset().mockResolvedValue({
      form: { getOwnResponse: mocks.serverGetOwnResponse },
    })
    mocks.notFound.mockReset().mockImplementation(() => {
      throw new Error('NEXT_NOT_FOUND')
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders VIEW read-only with unavailable questions and retained file names', () => {
    render(<OwnResponseClient locator="form" submissionId="response" response={payload('VIEW')} />)

    expect(screen.getByTestId('mode')).toHaveTextContent('VIEW')
    expect(screen.getByTestId('name')).toHaveTextContent('Старое имя')
    expect(screen.getByTestId('file-name')).toHaveTextContent('contract.pdf')
    expect(screen.getByTestId('picker-label')).toHaveTextContent('Виктор Иванов')
    expect(screen.getByTestId('unavailable')).toHaveTextContent('old')
    expect(screen.queryByRole('button', { name: 'Сохранить' })).not.toBeInTheDocument()
  })

  it('requires sign-in with an exact return path before reading the response', async () => {
    const page = await OwnResponsePage({
      params: Promise.resolve({ key: 'my form', submissionId: 'response/id' }),
    })
    render(page)

    expect(mocks.requireSession).toHaveBeenCalledWith(
      '/sign-in?redirect=%2Ff%2Fmy%2520form%2Fresponses%2Fresponse%252Fid',
    )
    expect(mocks.serverGetOwnResponse).toHaveBeenCalledWith({
      locator: 'my form',
      submissionId: 'response/id',
    })
  })

  it('collapses an inaccessible response to the route not-found state', async () => {
    mocks.serverGetOwnResponse.mockRejectedValue({ code: 'NOT_FOUND' })

    await expect(
      OwnResponsePage({
        params: Promise.resolve({ key: 'form', submissionId: 'missing' }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.notFound).toHaveBeenCalledOnce()
  })

  it('saves EDIT with the current revision and invalidates the protected query', async () => {
    const actor = userEvent.setup()
    const updated = payload('EDIT')
    updated.revision = 'c'.repeat(64)
    updated.answers = { name: 'Новое имя' }
    mocks.update.mockResolvedValue({ status: 'UPDATED' })
    mocks.getOwnResponse.mockResolvedValue(updated)
    render(<OwnResponseClient locator="form" submissionId="response" response={payload()} />)

    await actor.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce())
    expect(mocks.update).toHaveBeenCalledWith({
      locator: 'form',
      submissionId: 'response',
      expectedRevision: 'a'.repeat(64),
      answers: { name: 'Новое имя' },
      confirmClearUnreachable: false,
    })
    expect(await screen.findByRole('status')).toHaveTextContent('Изменения сохранены')
    expect(mocks.invalidate).toHaveBeenCalledWith({ locator: 'form', submissionId: 'response' })
  })

  it('requires explicit confirmation before clearing answers hidden by a branch', async () => {
    const actor = userEvent.setup()
    mocks.update
      .mockResolvedValueOnce({ status: 'CONFIRM_CLEAR_REQUIRED', questionIds: ['old'] })
      .mockResolvedValueOnce({ status: 'UPDATED' })
    render(<OwnResponseClient locator="form" submissionId="response" response={payload()} />)

    await actor.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Удалённое поле')
    expect(mocks.update).toHaveBeenCalledTimes(1)

    await actor.click(screen.getByRole('button', { name: 'Очистить и сохранить' }))
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2))
    expect(mocks.update.mock.calls[1]?.[0]).toMatchObject({ confirmClearUnreachable: true })
  })

  it('invalidates a pending clear confirmation after another local edit', async () => {
    const actor = userEvent.setup()
    mocks.update.mockResolvedValue({
      status: 'CONFIRM_CLEAR_REQUIRED',
      questionIds: ['old'],
    })
    render(<OwnResponseClient locator="form" submissionId="response" response={payload()} />)

    await actor.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByRole('button', { name: 'Очистить и сохранить' })).toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: 'Изменить после предупреждения' }))
    expect(screen.queryByRole('button', { name: 'Очистить и сохранить' })).not.toBeInTheDocument()
  })

  it('disables edits while a clear-confirmation request is in flight', async () => {
    const actor = userEvent.setup()
    const request = deferred<{ status: 'CONFIRM_CLEAR_REQUIRED'; questionIds: string[] }>()
    mocks.update.mockReturnValue(request.promise)
    render(<OwnResponseClient locator="form" submissionId="response" response={payload()} />)

    await actor.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'Изменить после предупреждения' })).toBeDisabled()
    request.resolve({ status: 'CONFIRM_CLEAR_REQUIRED', questionIds: ['old'] })

    expect(await screen.findByRole('button', { name: 'Очистить и сохранить' })).toBeEnabled()
  })

  it('disables edits while a successful save is in flight', async () => {
    const actor = userEvent.setup()
    const request = deferred<{ status: 'UPDATED' }>()
    mocks.update.mockReturnValue(request.promise)
    render(<OwnResponseClient locator="form" submissionId="response" response={payload()} />)

    await actor.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'Изменить после предупреждения' })).toBeDisabled()
    request.resolve({ status: 'UPDATED' })

    expect(await screen.findByRole('status')).toHaveTextContent('Изменения сохранены')
    expect(screen.getByRole('button', { name: 'Изменить после предупреждения' })).toBeEnabled()
  })

  it('uses protected picker and CAPTCHA-protected upload contexts even when the form is closed', async () => {
    const actor = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          uploadToken: 'fresh-lease',
          file: { name: 'new.txt', mimeType: 'text/plain', fileSize: '1' },
        }),
      ),
    )
    render(<OwnResponseClient locator="form" submissionId="response" response={payload()} />)

    await actor.click(screen.getByRole('button', { name: 'Загрузить' }))
    await waitFor(() => expect(document.body.dataset.ownUpload).toBe('fresh-lease'))
    expect(mocks.executeRecaptcha).toHaveBeenCalledWith('form_upload')
    expect(fetch).toHaveBeenCalledWith(
      '/api/forms/form/responses/response/uploads',
      expect.objectContaining({
        method: 'POST',
        headers: { 'x-captcha-response': 'captcha-token' },
      }),
    )

    await actor.click(screen.getByRole('button', { name: 'Найти' }))
    await waitFor(() => expect(document.body.dataset.ownPicker).toBe('1'))
    expect(mocks.picker).toHaveBeenCalledWith({
      locator: 'form',
      submissionId: 'response',
      questionId: 'person',
      ownResponseToken: 'picker-context',
      query: 'вик',
      cursor: undefined,
      limit: 50,
    })
  })
})
