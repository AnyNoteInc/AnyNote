// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PublicFormVersion } from '@repo/domain/database/forms'

const mocks = vi.hoisted(() => ({
  getPublished: vi.fn(),
}))

vi.mock('@/trpc/server', () => ({
  getServerTRPC: async () => ({ form: { getPublished: mocks.getPublished } }),
}))

vi.mock('@/app/(form)/f/[key]/form-page-client', () => ({
  FormPageClient: ({ locator }: { locator: string }) => (
    <div data-testid="form-page-client">{locator}</div>
  ),
}))

import FormPage from '@/app/(form)/f/[key]/page'
import { FormUnavailable } from '@/components/forms/form-unavailable'

const version: PublicFormVersion = {
  schemaVersion: 1,
  firstSectionId: 'section-1',
  presentation: { title: 'Заявка', submitButtonText: 'Отправить', hideAnyNoteBranding: false },
  sections: [{ id: 'section-1', title: 'Данные', questionIds: ['name'] }],
  questions: [
    {
      id: 'name',
      sectionId: 'section-1',
      valueType: 'TITLE',
      label: 'Имя',
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
      target: { kind: 'ENDING', endingId: 'done' },
    },
  ],
  endings: [{ id: 'done', title: 'Спасибо' }],
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('/f/[key]', () => {
  it('passes only the public payload and locator into the client renderer', async () => {
    mocks.getPublished.mockResolvedValue({
      status: 'OPEN',
      version,
      versionFingerprint: 'fingerprint',
      versionToken: 'signed-token',
      respondentKind: 'anonymous',
    })

    const page = await FormPage({ params: Promise.resolve({ key: 'anf_public' }) })
    expect(page.key).toBe('fingerprint')
    render(page)

    expect(mocks.getPublished).toHaveBeenCalledWith({ locator: 'anf_public' })
    expect(screen.getByTestId('form-page-client')).toHaveTextContent('anf_public')
  })

  it('collapses resolver failures to the uniform unavailable screen', async () => {
    mocks.getPublished.mockRejectedValue(new Error('database detail'))
    render(await FormPage({ params: Promise.resolve({ key: 'missing' }) }))
    expect(screen.getByRole('heading', { name: 'Форма недоступна' })).toBeInTheDocument()
    expect(screen.queryByText('database detail')).not.toBeInTheDocument()
  })
})

describe('FormUnavailable', () => {
  it.each([
    ['SCHEDULED', 'Форма откроется позже'],
    ['CLOSED', 'Приём ответов завершён'],
    ['CAPPED', 'Лимит ответов достигнут'],
    ['POLICY_DISABLED', 'Публичный доступ отключён'],
    ['UNAVAILABLE', 'Форма недоступна'],
  ] as const)('renders the dedicated %s state', (status, heading) => {
    render(
      <FormUnavailable
        locator="anf_public"
        state={
          status === 'SCHEDULED'
            ? { status, opensAt: new Date('2026-07-20T09:00:00.000Z') }
            : { status }
        }
      />,
    )
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
  })

  it('links authentication back to the exact encoded form URL', () => {
    render(<FormUnavailable locator="custom slug" state={{ status: 'AUTH_REQUIRED' }} />)
    expect(screen.getByRole('link', { name: 'Войти и продолжить' })).toHaveAttribute(
      'href',
      '/sign-in?redirect=%2Ff%2Fcustom%2520slug',
    )
  })
})
