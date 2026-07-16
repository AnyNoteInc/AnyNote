// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FormVersionDocument } from '@repo/domain/database/forms'

const mocks = vi.hoisted(() => ({
  createForm: vi.fn(),
  createView: vi.fn(),
  updateDraft: vi.fn(),
  updateProperty: vi.fn(),
  publish: vi.fn(),
  routerReplace: vi.fn(),
  refetchSchema: vi.fn(async () => ({ data: undefined })),
  currentForm: null as unknown,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.routerReplace }),
  useSearchParams: () => new URLSearchParams(),
}))

const invalidDocument: FormVersionDocument = {
  schemaVersion: 1,
  firstSectionId: 'section-1',
  presentation: {
    title: 'Обратная связь',
    submitButtonText: 'Отправить',
    hideAnyNoteBranding: false,
  },
  sections: [{ id: 'section-1', title: 'Вопросы', questionIds: ['q-title'] }],
  questions: [
    {
      id: 'q-title',
      sectionId: 'section-1',
      property: { kind: 'TITLE' },
      label: 'Ваше имя',
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
      target: { kind: 'ENDING', endingId: 'missing-ending' },
    },
  ],
  endings: [{ id: 'ending-1', title: 'Спасибо' }],
}

const managedForm = {
  id: '11111111-1111-4111-8111-111111111111',
  sourceId: '22222222-2222-4222-8222-222222222222',
  viewId: '33333333-3333-4333-8333-333333333333',
  routeKey: 'anf_route',
  customSlug: null,
  linkRevision: 1,
  state: 'DRAFT',
  audience: 'ANYONE_WITH_LINK',
  respondentAccess: 'NONE',
  draftSchema: invalidDocument,
  draftRevision: 3,
  publishedVersionId: null,
  opensAt: null,
  closesAt: null,
  responseLimit: null,
  acceptedResponses: 0,
  notifyOwners: false,
  createdById: '44444444-4444-4444-8444-444444444444',
  createdAt: new Date(),
  updatedAt: new Date(),
  source: {
    id: '22222222-2222-4222-8222-222222222222',
    workspaceId: '55555555-5555-4555-8555-555555555555',
    pageId: '66666666-6666-4666-8666-666666666666',
    structureLocked: false,
    page: {
      id: '66666666-6666-4666-8666-666666666666',
      createdById: '44444444-4444-4444-8444-444444444444',
      archivedAt: null,
      deletedAt: null,
    },
    workspace: { id: '55555555-5555-4555-8555-555555555555', securityPolicy: null },
    properties: [],
  },
  view: { id: '33333333-3333-4333-8333-333333333333', title: 'Форма', position: 1024 },
  createdBy: { id: '44444444-4444-4444-8444-444444444444', name: 'Владелец' },
  publishedVersion: null,
}

vi.mock('@/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      database: {
        getByPage: { invalidate: vi.fn() },
        listForms: { invalidate: vi.fn() },
        getForm: { invalidate: vi.fn() },
      },
    }),
    database: {
      listForms: { useQuery: () => ({ data: [managedForm], isLoading: false, error: null }) },
      getForm: {
        useQuery: () => ({
          data: mocks.currentForm ?? managedForm,
          isLoading: false,
          error: null,
          refetch: vi.fn(async () => ({ data: mocks.currentForm ?? managedForm })),
        }),
      },
      getByPage: {
        useQuery: () => ({
          data: undefined,
          isLoading: false,
          error: null,
          refetch: mocks.refetchSchema,
        }),
      },
      createForm: { useMutation: () => ({ mutate: mocks.createForm }) },
      createView: { useMutation: () => ({ mutate: mocks.createView }) },
      updateView: { useMutation: () => ({ mutate: vi.fn() }) },
      duplicateView: { useMutation: () => ({ mutate: vi.fn() }) },
      deleteView: { useMutation: () => ({ mutate: vi.fn() }) },
      updateFormDraft: {
        useMutation: () => ({ mutateAsync: mocks.updateDraft, isPending: false }),
      },
      publishForm: { useMutation: () => ({ mutateAsync: mocks.publish, isPending: false }) },
      updateProperty: {
        useMutation: () => ({ mutateAsync: mocks.updateProperty, isPending: false }),
      },
      createProperty: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      listSources: { useQuery: () => ({ data: [] }) },
      updateFormSettings: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      setFormSlug: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      rotateFormKey: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      closeForm: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      reopenForm: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      listFormResponses: {
        useInfiniteQuery: () => ({ data: undefined, isLoading: false, hasNextPage: false }),
      },
    },
  },
}))

vi.mock('@/components/workspace/plan-features-context', () => ({
  usePlanFeatures: () => ({
    formConditionalLogicEnabled: true,
    formCustomSlugEnabled: true,
    formBrandingRemovalEnabled: true,
  }),
}))

import { FormBuilder } from '@/components/database/forms/form-builder'
import { DatabaseViewTabs } from '@/components/database/database-view-tabs'

describe('database FORM UI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.currentForm = managedForm
  })
  afterEach(cleanup)

  it('renders FORM tab icon/title/menu and creates it through createForm only', async () => {
    const actor = userEvent.setup()
    render(
      <DatabaseViewTabs
        pageId="66666666-6666-4666-8666-666666666666"
        activeViewId="33333333-3333-4333-8333-333333333333"
        views={[
          {
            id: '33333333-3333-4333-8333-333333333333',
            type: 'FORM',
            title: 'Анкета',
            position: 1024,
            settings: {},
          },
        ]}
        editable
        myAccess={{
          canEditContent: true,
          canEditStructure: true,
          canManageExposure: true,
          structureLocked: false,
        }}
      />,
    )

    expect(screen.getByRole('tab', { name: /Анкета/u })).toBeInTheDocument()
    await actor.click(screen.getByRole('button', { name: 'Добавить представление' }))
    await actor.click(screen.getByRole('menuitem', { name: 'Форма' }))
    expect(mocks.createForm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Форма' }))
    expect(mocks.createView).not.toHaveBeenCalled()
  })

  it('renders the three-panel open-document builder, inline graph error and disabled publish', () => {
    render(
      <FormBuilder
        pageId="66666666-6666-4666-8666-666666666666"
        formViewId="33333333-3333-4333-8333-333333333333"
      />,
    )

    expect(screen.getByRole('complementary', { name: 'Структура формы' })).toBeInTheDocument()
    expect(screen.getByRole('main', { name: 'Предпросмотр формы' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Настройки формы' })).toBeInTheDocument()
    expect(screen.getByText(/ошибок: 2/u)).toBeInTheDocument()
    expect(screen.getByText(/Публикация недоступна/u)).toBeInTheDocument()
    expect(
      within(screen.getByTestId('transition-card-transition-1')).getByText(
        'TRANSITION_TARGET_ENDING_NOT_FOUND',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Опубликовать' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled()
  })

  it('keeps viewing available while disabling every form mutation without its capability', () => {
    mocks.currentForm = {
      ...managedForm,
      draftSchema: {
        ...invalidDocument,
        transitions: [
          {
            ...invalidDocument.transitions[0]!,
            target: { kind: 'ENDING' as const, endingId: 'ending-1' },
          },
        ],
      },
    }

    render(
      <FormBuilder
        pageId="66666666-6666-4666-8666-666666666666"
        formViewId="33333333-3333-4333-8333-333333333333"
        canEditStructure={false}
        canManageExposure={false}
        canEditContent={false}
      />,
    )

    expect(screen.getByRole('button', { name: 'Предпросмотр' })).toBeEnabled()
    expect(screen.getByRole('button', { name: /^Ответы/u })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Поделиться' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Опубликовать' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Добавить раздел' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Добавить завершение' })).toBeDisabled()
    expect(screen.getByLabelText('Название раздела')).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Название раздела'), {
      target: { value: 'Unauthorized local edit' },
    })
    expect(screen.getByLabelText('Название раздела')).toHaveValue('Вопросы')
    expect(screen.getByText('Только просмотр')).toBeInTheDocument()
  })

  it('disables exposure mutations if that capability is revoked while the dialog is open', async () => {
    const actor = userEvent.setup()
    const props = {
      pageId: '66666666-6666-4666-8666-666666666666',
      formViewId: '33333333-3333-4333-8333-333333333333',
      canEditStructure: true,
      canEditContent: true,
    }
    const { rerender } = render(<FormBuilder {...props} canManageExposure />)

    await actor.click(screen.getByRole('button', { name: 'Поделиться' }))
    expect(screen.getByRole('dialog', { name: 'Публикация и доступ' })).toBeInTheDocument()

    rerender(<FormBuilder {...props} canManageExposure={false} />)
    expect(screen.getByRole('dialog', { name: 'Публикация и доступ' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сохранить настройки' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Сменить секретную ссылку' })).toBeDisabled()
    expect(screen.getByLabelText('Свой адрес')).toBeDisabled()
  })

  it('stops the 700ms autosave and exposes recovery actions after a stale revision conflict', async () => {
    vi.useFakeTimers()
    mocks.updateDraft.mockRejectedValueOnce({
      data: { code: 'CONFLICT' },
      message: 'FORM_DRAFT_CONFLICT',
    })
    try {
      render(
        <FormBuilder
          pageId="66666666-6666-4666-8666-666666666666"
          formViewId="33333333-3333-4333-8333-333333333333"
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: /Ваше имя/u }))
      fireEvent.change(screen.getByLabelText('Текст вопроса'), {
        target: { value: 'Как вас зовут?' },
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(700)
      })

      expect(screen.getByText('Конфликт версий')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Перезагрузить' })).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /Скопировать локальный JSON/u }),
      ).toBeInTheDocument()
      expect(mocks.updateDraft).toHaveBeenCalledWith(
        expect.objectContaining({ expectedRevision: 3 }),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('saves synced property rename intents atomically with the draft and retries as one mutation', async () => {
    vi.useFakeTimers()
    const propertyDocument: FormVersionDocument = {
      ...invalidDocument,
      questions: [
        {
          ...invalidDocument.questions[0]!,
          property: {
            kind: 'PROPERTY',
            propertyId: '77777777-7777-4777-8777-777777777777',
            propertyType: 'TEXT',
          },
          syncWithPropertyName: true,
          input: { kind: 'TEXT', multiline: false, maxLength: 2_000 },
        },
      ],
    }
    const propertyForm = {
      ...managedForm,
      draftSchema: propertyDocument,
      source: {
        ...managedForm.source,
        properties: [
          {
            id: '77777777-7777-4777-8777-777777777777',
            name: 'Ваше имя',
            type: 'TEXT',
            settings: {},
          },
        ],
      },
    }
    mocks.currentForm = propertyForm
    mocks.updateDraft
      .mockRejectedValueOnce(new Error('Свойство временно недоступно'))
      .mockResolvedValueOnce({ ...propertyForm, draftRevision: 4 })

    try {
      render(
        <FormBuilder
          pageId="66666666-6666-4666-8666-666666666666"
          formViewId="33333333-3333-4333-8333-333333333333"
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /Ваше имя/u }))
      fireEvent.change(screen.getByLabelText('Текст вопроса'), {
        target: { value: 'Как вас зовут?' },
      })

      await act(async () => vi.advanceTimersByTimeAsync(700))
      expect(screen.getByText('Свойство временно недоступно')).toBeInTheDocument()
      expect(mocks.updateDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          propertyNameIntents: {
            '77777777-7777-4777-8777-777777777777': 'Как вас зовут?',
          },
        }),
      )
      expect(mocks.updateProperty).not.toHaveBeenCalled()

      await act(async () => vi.advanceTimersByTimeAsync(700))
      expect(mocks.updateDraft).toHaveBeenCalledTimes(2)
      expect(mocks.updateDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedRevision: 3,
          schema: expect.objectContaining({
            questions: [expect.objectContaining({ label: 'Как вас зовут?' })],
          }),
        }),
      )
      expect(mocks.updateProperty).not.toHaveBeenCalled()
      expect(screen.getByText('Сохранено')).toBeInTheDocument()
      expect(mocks.refetchSchema).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
