// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FormVersionDocument } from '@repo/domain/database/forms'

import type { DatabaseManagedForm } from '@/components/database/types'

const mocks = vi.hoisted(() => ({
  features: {
    formConditionalLogicEnabled: true,
    formCustomSlugEnabled: true,
    formBrandingRemovalEnabled: true,
  },
  updateSettings: vi.fn(),
  setSlug: vi.fn(),
  rotate: vi.fn(),
  close: vi.fn(),
  reopen: vi.fn(),
}))

vi.mock('@/components/workspace/plan-features-context', () => ({
  usePlanFeatures: () => mocks.features,
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    database: {
      updateFormSettings: { useMutation: () => ({ mutateAsync: mocks.updateSettings }) },
      setFormSlug: { useMutation: () => ({ mutateAsync: mocks.setSlug }) },
      rotateFormKey: { useMutation: () => ({ mutateAsync: mocks.rotate }) },
      closeForm: { useMutation: () => ({ mutateAsync: mocks.close }) },
      reopenForm: { useMutation: () => ({ mutateAsync: mocks.reopen }) },
    },
  },
}))

import { FormSharePanel } from '@/components/database/forms/form-share-panel'

const publishedDocument: FormVersionDocument = {
  schemaVersion: 1,
  firstSectionId: 'section-1',
  presentation: { title: 'Заявка', submitButtonText: 'Отправить', hideAnyNoteBranding: false },
  sections: [{ id: 'section-1', title: 'Контакты', questionIds: ['question-1'] }],
  questions: [
    {
      id: 'question-1',
      sectionId: 'section-1',
      property: { kind: 'TITLE' },
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
      target: { kind: 'ENDING', endingId: 'ending-1' },
    },
  ],
  endings: [{ id: 'ending-1', title: 'Спасибо' }],
}

const form: DatabaseManagedForm = {
  id: 'form-1',
  sourceId: 'source-1',
  viewId: 'view-1',
  routeKey: 'secret',
  customSlug: null,
  linkRevision: 1,
  state: 'OPEN',
  audience: 'ANYONE_WITH_LINK',
  respondentAccess: 'NONE',
  draftSchema: publishedDocument,
  draftRevision: 1,
  publishedVersionId: 'version-1',
  publishedVersion: { versionNumber: 4, schema: publishedDocument },
  opensAt: null,
  closesAt: null,
  responseLimit: null,
  acceptedResponses: 2,
  notifyOwners: false,
  source: { properties: [] },
}

describe('FormSharePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.features.formConditionalLogicEnabled = true
    mocks.features.formCustomSlugEnabled = true
    mocks.features.formBrandingRemovalEnabled = true
    mocks.updateSettings.mockResolvedValue({})
    mocks.rotate.mockResolvedValue({})
  })
  afterEach(cleanup)

  it('shows the published version, detects draft changes and saves access settings', async () => {
    const actor = userEvent.setup()
    const onChanged = vi.fn()
    render(
      <FormSharePanel
        open
        pageId="page-1"
        form={form}
        draftDocument={{
          ...publishedDocument,
          presentation: { ...publishedDocument.presentation, title: 'Новая заявка' },
        }}
        hideBranding={false}
        onClose={() => undefined}
        onChanged={onChanged}
        onBrandingChange={() => undefined}
      />,
    )

    expect(screen.getByText(/Опубликована версия 4/u)).toHaveTextContent(
      'Есть неопубликованные изменения',
    )
    await actor.click(screen.getByRole('combobox', { name: 'Кто может отвечать' }))
    await actor.click(screen.getByRole('option', { name: 'Вошедшие пользователи' }))
    await actor.click(screen.getByRole('button', { name: 'Сохранить настройки' }))

    expect(mocks.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: 'page-1',
        formId: 'form-1',
        audience: 'SIGNED_IN_WITH_LINK',
      }),
    )
    expect(onChanged).toHaveBeenCalled()
  })

  it('reflects plan gates and requires confirmation before rotating the key', async () => {
    const actor = userEvent.setup()
    mocks.features.formConditionalLogicEnabled = false
    mocks.features.formCustomSlugEnabled = false
    mocks.features.formBrandingRemovalEnabled = false
    render(
      <FormSharePanel
        open
        pageId="page-1"
        form={form}
        draftDocument={{
          ...publishedDocument,
          presentation: { ...publishedDocument.presentation, description: undefined },
        }}
        hideBranding={false}
        onClose={() => undefined}
        onChanged={() => undefined}
        onBrandingChange={() => undefined}
      />,
    )

    expect(screen.getByText(/Все изменения опубликованы/u)).toBeInTheDocument()
    expect(screen.getByLabelText('Свой адрес')).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Скрыть брендинг AnyNote' })).toBeDisabled()

    await actor.click(screen.getByRole('button', { name: 'Сменить секретную ссылку' }))
    expect(screen.getByText('Старая ссылка сразу перестанет работать.')).toBeInTheDocument()
    expect(mocks.rotate).not.toHaveBeenCalled()
    await actor.click(screen.getByRole('button', { name: 'Сменить' }))
    expect(mocks.rotate).toHaveBeenCalledWith({ pageId: 'page-1', formId: 'form-1' })
  })
})
