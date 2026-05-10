// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({
  setMarketingMutate: vi.fn(),
  invalidate: vi.fn(),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    consent: {
      setMarketing: {
        useMutation: ({ onSuccess }: { onSuccess?: () => void } = {}) => ({
          mutate: (...args: unknown[]) => {
            mocks.setMarketingMutate(...args)
            onSuccess?.()
          },
          isPending: false,
        }),
      },
      list: { invalidate: mocks.invalidate },
    },
    useUtils: () => ({ consent: { list: { invalidate: mocks.invalidate } } }),
  },
}))

import { ConsentsTable, type ConsentsTableRow } from '@/app/(protected)/settings/consents/consents-table'

const ROWS: ConsentsTableRow[] = [
  {
    documentType: 'USER_AGREEMENT',
    title: 'Пользовательское соглашение',
    url: '/terms/user-agreement',
    required: true,
    granted: true,
    grantedAt: new Date('2026-05-10T14:30:00Z'),
  },
  {
    documentType: 'PRIVACY_POLICY',
    title: 'Политика обработки персональных данных',
    url: '/terms/privacy-policy',
    required: true,
    granted: true,
    grantedAt: new Date('2026-05-10T14:30:00Z'),
  },
  {
    documentType: 'PII_PROCESSING',
    title: 'Согласие на обработку персональных данных',
    url: '/terms/consent',
    required: true,
    granted: true,
    grantedAt: new Date('2026-05-10T14:30:00Z'),
  },
  {
    documentType: 'PUBLIC_OFFER',
    title: 'Оферта на оказание услуг',
    url: '/terms/public-offer',
    required: true,
    granted: true,
    grantedAt: new Date('2026-05-10T14:30:00Z'),
  },
  {
    documentType: 'MARKETING',
    title: 'Согласие на получение информационных и рекламных рассылок',
    url: '/terms/marketing-consent',
    required: false,
    granted: false,
    grantedAt: null,
  },
]

describe('ConsentsTable', () => {
  beforeEach(() => {
    mocks.setMarketingMutate.mockClear()
    mocks.invalidate.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders 5 rows including marketing', () => {
    render(<ConsentsTable rows={ROWS} />)
    expect(screen.getAllByRole('row')).toHaveLength(6) // header + 5
    expect(screen.getByText('Пользовательское соглашение')).toBeInTheDocument()
    expect(screen.getByText(/информационных и рекламных рассылок/i)).toBeInTheDocument()
  })

  it('renders 5 "Открыть" links pointing to terms pages', () => {
    render(<ConsentsTable rows={ROWS} />)
    expect(screen.getAllByRole('link', { name: /открыть/i })).toHaveLength(5)
  })

  it('shows a Switch only on the marketing row', () => {
    render(<ConsentsTable rows={ROWS} />)
    expect(screen.getAllByRole('switch')).toHaveLength(1)
  })

  it('calls setMarketing when toggled', async () => {
    render(<ConsentsTable rows={ROWS} />)
    await userEvent.click(screen.getByRole('switch'))
    expect(mocks.setMarketingMutate).toHaveBeenCalledWith({ granted: true })
  })
})
