// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PublicFormQuestion, PublicFormVersion } from '@repo/domain/database/forms'

import { FormRenderer } from '@/components/forms/form-renderer'
import { FormUploadField } from '@/components/forms/form-upload-field'

const version: PublicFormVersion = {
  schemaVersion: 1,
  firstSectionId: 'intro',
  presentation: {
    title: 'Регистрация на встречу',
    description: 'Ответы сохраняются только после отправки.',
    organizationName: 'Команда AnyNote',
    submitButtonText: 'Отправить заявку',
    hideAnyNoteBranding: false,
  },
  sections: [
    { id: 'intro', title: 'О вас', questionIds: ['name', 'details-toggle'] },
    { id: 'details', title: 'Контакты', questionIds: ['email'] },
  ],
  questions: [
    {
      id: 'name',
      sectionId: 'intro',
      valueType: 'TITLE',
      label: 'Имя',
      required: true,
      syncWithPropertyName: false,
      input: { kind: 'TEXT', multiline: false, maxLength: 200 },
    },
    {
      id: 'details-toggle',
      sectionId: 'intro',
      valueType: 'CHECKBOX',
      label: 'Добавить контакты',
      required: false,
      syncWithPropertyName: false,
      input: { kind: 'CHECKBOX', consent: false },
    },
    {
      id: 'email',
      sectionId: 'details',
      valueType: 'EMAIL',
      label: 'Email',
      description: 'Пришлём подтверждение',
      required: true,
      syncWithPropertyName: false,
      input: { kind: 'EMAIL' },
    },
  ],
  transitions: [
    {
      id: 'with-details',
      fromSectionId: 'intro',
      priority: 0,
      when: {
        kind: 'ALL',
        members: [{ kind: 'CHECKBOX_IS', questionId: 'details-toggle', value: true }],
      },
      target: { kind: 'SECTION', sectionId: 'details' },
    },
    {
      id: 'skip-details',
      fromSectionId: 'intro',
      priority: 1,
      when: null,
      target: { kind: 'ENDING', endingId: 'done' },
    },
    {
      id: 'details-done',
      fromSectionId: 'details',
      priority: 0,
      when: null,
      target: { kind: 'ENDING', endingId: 'done' },
    },
  ],
  endings: [{ id: 'done', title: 'Спасибо', body: 'Ответ принят' }],
}

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

function fieldVersion(questions: PublicFormQuestion[]): PublicFormVersion {
  return {
    ...version,
    firstSectionId: 'fields',
    presentation: { ...version.presentation, title: 'Поля' },
    sections: [{ id: 'fields', title: 'Поля', questionIds: questions.map(({ id }) => id) }],
    questions: questions.map((question) => ({ ...question, sectionId: 'fields' })),
    transitions: [
      {
        id: 'fields-done',
        fromSectionId: 'fields',
        priority: 0,
        when: null,
        target: { kind: 'ENDING', endingId: 'done' },
      },
    ],
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('public FormRenderer', () => {
  it('validates each section, supports Back and excludes newly unreachable values', async () => {
    const actor = userEvent.setup()
    const onSubmit = vi.fn()
    render(<FormRenderer version={version} mode="public" onSubmit={onSubmit} />)

    await actor.click(screen.getByRole('checkbox', { name: 'Добавить контакты' }))
    await actor.click(screen.getByRole('button', { name: 'Далее' }))
    expect(await screen.findByText('Заполните обязательное поле')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'О вас' })).toBeInTheDocument()

    await actor.type(screen.getByRole('textbox', { name: 'Имя *' }), 'Виктор')
    await actor.click(screen.getByRole('button', { name: 'Далее' }))
    expect(screen.getByRole('heading', { name: 'Контакты' })).toBeInTheDocument()
    await actor.type(screen.getByRole('textbox', { name: 'Email *' }), 'v@example.test')

    await actor.click(screen.getByRole('button', { name: 'Назад' }))
    await actor.click(screen.getByRole('checkbox', { name: 'Добавить контакты' }))
    await actor.click(screen.getByRole('button', { name: 'Отправить заявку' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        answers: { name: 'Виктор', 'details-toggle': false },
      }),
    )
  })

  it('restores initial answers and reports answer changes for local drafts', async () => {
    const actor = userEvent.setup()
    const onAnswersChange = vi.fn()
    render(
      <FormRenderer
        version={version}
        mode="public"
        initialAnswers={{ name: 'Сохранённое имя' }}
        onAnswersChange={onAnswersChange}
      />,
    )

    const name = screen.getByRole('textbox', { name: 'Имя *' })
    expect(name).toHaveValue('Сохранённое имя')
    await actor.type(name, ' и новое')
    await waitFor(() =>
      expect(onAnswersChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ name: 'Сохранённое имя и новое' }),
      ),
    )
  })

  it('maps server field errors to their section and focuses the first field', async () => {
    render(
      <FormRenderer
        version={version}
        mode="public"
        initialAnswers={{ name: 'Виктор', 'details-toggle': true }}
        serverFieldErrors={{ email: ['FORM_TARGET_INACCESSIBLE'] }}
      />,
    )

    expect(await screen.findByRole('heading', { name: 'Контакты' })).toBeInTheDocument()
    expect(screen.getByText('Выбранное значение недоступно. Выберите другое.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Email *' })).toHaveFocus())
  })

  it('supports keyboard section navigation and focuses the current required error', async () => {
    const actor = userEvent.setup()
    render(
      <FormRenderer
        version={version}
        mode="public"
        initialAnswers={{ name: 'Виктор', 'details-toggle': true }}
      />,
    )

    const name = screen.getByRole('textbox', { name: 'Имя *' })
    name.focus()
    await actor.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { name: 'Контакты' })).toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: 'Отправить заявку' }))
    expect(await screen.findByText('Заполните обязательное поле')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Email *' })).toHaveFocus()
  })

  it('shows portal context, progress and AnyNote branding', () => {
    render(<FormRenderer version={version} mode="public" />)
    expect(screen.getByText('Команда AnyNote')).toBeInTheDocument()
    expect(screen.getByText('Раздел 1 из 1')).toBeInTheDocument()
    expect(screen.getByText('Создано в AnyNote')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Разделы формы' })).toBeInTheDocument()
  })

  it('renders only an AnyNote-hosted cover without disclosing the form URL as a referrer', () => {
    const coveredVersion: PublicFormVersion = {
      ...version,
      presentation: {
        ...version.presentation,
        cover: { kind: 'image', value: '/logo.png' },
      },
    }
    const { container } = render(<FormRenderer version={coveredVersion} mode="public" />)

    expect(container.querySelector('img')).toHaveAttribute('referrerpolicy', 'no-referrer')
  })

  it('clears a public draft only through the explicit reset control', async () => {
    const actor = userEvent.setup()
    const onReset = vi.fn()
    render(
      <FormRenderer
        version={version}
        mode="public"
        initialAnswers={{ name: 'Черновик' }}
        onReset={onReset}
      />,
    )

    await actor.click(screen.getByRole('button', { name: 'Сбросить черновик' }))

    expect(screen.getByRole('textbox', { name: 'Имя *' })).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Сбросить черновик' })).not.toBeInTheDocument()
    expect(onReset).toHaveBeenCalledOnce()
  })

  it('renders the configured ending after a successful submission', () => {
    render(<FormRenderer version={version} mode="public" successEndingId="done" />)

    expect(screen.getByRole('heading', { name: 'Спасибо' })).toBeInTheDocument()
    expect(screen.getByText('Ответ принят')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Отправить заявку' })).not.toBeInTheDocument()
  })

  it('uploads files and loads internal picker options through public callbacks', async () => {
    const actor = userEvent.setup()
    const onUpload = vi.fn().mockResolvedValue({ token: 'lease-token', name: 'brief.pdf' })
    const onLoadPickerOptions = vi.fn().mockResolvedValue({
      items: [{ id: 'person-1', label: 'Анна' }],
      nextCursor: null,
    })
    const fieldVersion: PublicFormVersion = {
      ...version,
      sections: [{ id: 'intro', title: 'Материалы', questionIds: ['file', 'person'] }],
      questions: [
        {
          id: 'file',
          sectionId: 'intro',
          valueType: 'FILE',
          label: 'Презентация',
          required: false,
          syncWithPropertyName: false,
          input: {
            kind: 'FILE',
            allowedMimeTypes: ['application/pdf'],
            maxBytesPerFile: 1_000_000,
            maxFiles: 2,
          },
        },
        {
          id: 'person',
          sectionId: 'intro',
          valueType: 'PERSON',
          label: 'Ответственный',
          required: false,
          syncWithPropertyName: false,
          input: { kind: 'PERSON', maxSelections: 2 },
        },
      ],
      transitions: [
        {
          id: 'done',
          fromSectionId: 'intro',
          priority: 0,
          when: null,
          target: { kind: 'ENDING', endingId: 'done' },
        },
      ],
    }
    const onSubmit = vi.fn()
    const { container } = render(
      <FormRenderer
        version={fieldVersion}
        mode="public"
        onSubmit={onSubmit}
        onUpload={onUpload}
        onLoadPickerOptions={onLoadPickerOptions}
      />,
    )

    const file = new File(['pdf'], 'brief.pdf', { type: 'application/pdf' })
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(fileInput).not.toBeNull()
    await actor.upload(fileInput!, file)
    expect(await screen.findByText('brief.pdf')).toBeInTheDocument()

    await actor.click(screen.getByRole('textbox', { name: 'Поиск: Ответственный' }))
    expect(await screen.findByRole('option', { name: 'Выбрать Анна' })).toBeInTheDocument()
    await actor.click(screen.getByRole('option', { name: 'Выбрать Анна' }))
    await actor.click(screen.getByRole('button', { name: 'Отправить заявку' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        answers: { file: ['lease-token'], person: ['person-1'] },
      }),
    )
  })

  it('rejects a file whose MIME type is outside the question contract', async () => {
    const actor = userEvent.setup({ applyAccept: false })
    const onUpload = vi.fn()
    const { container } = render(
      <FormUploadField
        questionId="file"
        label="Документ"
        allowedMimeTypes={['application/pdf']}
        maxBytesPerFile={1_000_000}
        maxFiles={1}
        value={[]}
        onChange={vi.fn()}
        onUpload={onUpload}
      />,
    )

    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()
    await actor.upload(input!, new File(['image'], 'photo.png', { type: 'image/png' }))

    expect(await screen.findByText('Этот тип файла не разрешён')).toBeInTheDocument()
    expect(onUpload).not.toHaveBeenCalled()
  })

  it('adapts number, choice, date, URL, phone, relation and page-link values', async () => {
    const actor = userEvent.setup()
    const adapterVersion: PublicFormVersion = {
      ...version,
      sections: [
        {
          id: 'intro',
          title: 'Все поля',
          questionIds: ['number', 'single', 'multi', 'date', 'url', 'phone', 'relation', 'page'],
        },
      ],
      questions: [
        {
          id: 'number',
          sectionId: 'intro',
          valueType: 'NUMBER',
          label: 'Количество',
          required: false,
          syncWithPropertyName: false,
          input: { kind: 'NUMBER', min: 1, max: 10, step: 1 },
        },
        {
          id: 'single',
          sectionId: 'intro',
          valueType: 'SELECT',
          label: 'Приоритет',
          required: false,
          syncWithPropertyName: false,
          input: {
            kind: 'SINGLE_CHOICE',
            appearance: 'RADIO',
            options: [{ id: 'high', label: 'Высокий' }],
          },
        },
        {
          id: 'multi',
          sectionId: 'intro',
          valueType: 'MULTI_SELECT',
          label: 'Теги',
          required: false,
          syncWithPropertyName: false,
          input: {
            kind: 'MULTI_CHOICE',
            appearance: 'CHECKLIST',
            options: [{ id: 'tag-a', label: 'Опция A' }],
            maxSelections: 2,
          },
        },
        {
          id: 'date',
          sectionId: 'intro',
          valueType: 'DATE',
          label: 'Дата',
          required: false,
          syncWithPropertyName: false,
          input: { kind: 'DATE', includeTime: false },
        },
        {
          id: 'url',
          sectionId: 'intro',
          valueType: 'URL',
          label: 'Сайт',
          required: false,
          syncWithPropertyName: false,
          input: { kind: 'URL' },
        },
        {
          id: 'phone',
          sectionId: 'intro',
          valueType: 'PHONE',
          label: 'Телефон',
          required: false,
          syncWithPropertyName: false,
          input: { kind: 'PHONE' },
        },
        {
          id: 'relation',
          sectionId: 'intro',
          valueType: 'RELATION',
          label: 'Проекты',
          required: false,
          syncWithPropertyName: false,
          input: { kind: 'RELATION', maxSelections: 2 },
        },
        {
          id: 'page',
          sectionId: 'intro',
          valueType: 'PAGE_LINK',
          label: 'Страница',
          required: false,
          syncWithPropertyName: false,
          input: { kind: 'PAGE_LINK' },
        },
      ],
      transitions: [
        {
          id: 'done',
          fromSectionId: 'intro',
          priority: 0,
          when: null,
          target: { kind: 'ENDING', endingId: 'done' },
        },
      ],
    }
    const onSubmit = vi.fn()
    const onLoadPickerOptions = vi.fn(async (questionId: string) => ({
      items:
        questionId === 'relation'
          ? [{ id: 'project-1', label: 'Проект 1' }]
          : [{ id: 'page-1', label: 'Страница 1' }],
      nextCursor: null,
    }))
    render(
      <FormRenderer
        version={adapterVersion}
        mode="public"
        onSubmit={onSubmit}
        onLoadPickerOptions={onLoadPickerOptions}
      />,
    )

    await actor.type(screen.getByRole('spinbutton', { name: 'Количество' }), '3')
    await actor.click(screen.getByRole('radio', { name: 'Высокий' }))
    await actor.click(screen.getByRole('checkbox', { name: 'Опция A' }))
    fireEvent.change(screen.getByLabelText('Дата'), { target: { value: '2026-08-01' } })
    await actor.type(screen.getByRole('textbox', { name: 'Сайт' }), 'https://anynote.ru')
    await actor.type(screen.getByRole('textbox', { name: 'Телефон' }), '+7 999 123-45-67')

    await actor.click(screen.getByRole('textbox', { name: 'Поиск: Проекты' }))
    await actor.click(await screen.findByRole('option', { name: 'Выбрать Проект 1' }))
    await actor.click(screen.getByRole('textbox', { name: 'Поиск: Страница' }))
    await actor.click(await screen.findByRole('option', { name: 'Выбрать Страница 1' }))
    await actor.click(screen.getByRole('button', { name: 'Отправить заявку' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        answers: {
          number: 3,
          single: 'high',
          multi: ['tag-a'],
          date: '2026-08-01',
          url: 'https://anynote.ru',
          phone: '+7 999 123-45-67',
          relation: ['project-1'],
          page: 'page-1',
        },
      }),
    )
  })

  it('blocks submission while an optional upload is pending', async () => {
    const actor = userEvent.setup()
    const upload = deferred<{ token: string; name: string }>()
    const onSubmit = vi.fn()
    const uploadQuestion: PublicFormQuestion = {
      id: 'file',
      sectionId: 'fields',
      valueType: 'FILE',
      label: 'Вложение',
      required: false,
      syncWithPropertyName: false,
      input: {
        kind: 'FILE',
        allowedMimeTypes: ['application/pdf'],
        maxBytesPerFile: 1_000_000,
        maxFiles: 1,
      },
    }
    const { container } = render(
      <FormRenderer
        version={fieldVersion([uploadQuestion])}
        mode="public"
        onUpload={() => upload.promise}
        onSubmit={onSubmit}
      />,
    )

    await actor.upload(
      container.querySelector<HTMLInputElement>('input[type="file"]')!,
      new File(['pdf'], 'wait.pdf', { type: 'application/pdf' }),
    )
    expect(screen.getByRole('button', { name: 'Загрузка…' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Отправить заявку' })).toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()

    await act(async () => upload.resolve({ token: 'lease', name: 'wait.pdf' }))
    await actor.click(await screen.findByRole('button', { name: 'Отправить заявку' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ answers: { file: ['lease'] } }))
  })

  it('ignores an upload completion after the field unmounts', async () => {
    const actor = userEvent.setup()
    const upload = deferred<{ token: string; name: string }>()
    const onChange = vi.fn()
    const onPendingChange = vi.fn()
    const { container, unmount } = render(
      <FormUploadField
        questionId="file"
        label="Документ"
        allowedMimeTypes={['application/pdf']}
        maxBytesPerFile={1_000_000}
        maxFiles={1}
        value={[]}
        onChange={onChange}
        onUpload={() => upload.promise}
        onPendingChange={onPendingChange}
      />,
    )
    await actor.upload(
      container.querySelector<HTMLInputElement>('input[type="file"]')!,
      new File(['pdf'], 'late.pdf', { type: 'application/pdf' }),
    )
    unmount()
    await act(async () => upload.resolve({ token: 'late', name: 'late.pdf' }))

    expect(onChange).not.toHaveBeenCalled()
    expect(onPendingChange).toHaveBeenLastCalledWith(false)
  })

  it('accepts a delayed upload completion under StrictMode', async () => {
    const actor = userEvent.setup()
    const upload = deferred<{ token: string; name: string }>()
    const onChange = vi.fn()
    const { container } = render(
      <StrictMode>
        <FormUploadField
          questionId="file"
          label="Документ"
          allowedMimeTypes={['application/pdf']}
          maxBytesPerFile={1_000_000}
          maxFiles={1}
          value={[]}
          onChange={onChange}
          onUpload={() => upload.promise}
        />
      </StrictMode>,
    )
    await actor.upload(
      container.querySelector<HTMLInputElement>('input[type="file"]')!,
      new File(['pdf'], 'strict.pdf', { type: 'application/pdf' }),
    )

    await act(async () => upload.resolve({ token: 'strict-token', name: 'strict.pdf' }))

    expect(onChange).toHaveBeenCalledWith(['strict-token'])
  })

  it('preserves an explicitly dirty false checkbox in local draft updates', async () => {
    const actor = userEvent.setup()
    const onAnswersChange = vi.fn()
    const falseBranchVersion: PublicFormVersion = {
      ...version,
      sections: [
        { id: 'intro', title: 'О вас', questionIds: ['details-toggle'] },
        { id: 'declined', title: 'Отказ', questionIds: [] },
      ],
      questions: version.questions.filter(({ id }) => id === 'details-toggle'),
      transitions: [
        {
          id: 'declined-answer',
          fromSectionId: 'intro',
          priority: 0,
          when: {
            kind: 'ALL',
            members: [{ kind: 'CHECKBOX_IS', questionId: 'details-toggle', value: false }],
          },
          target: { kind: 'SECTION', sectionId: 'declined' },
        },
        {
          id: 'missing-answer',
          fromSectionId: 'intro',
          priority: 1,
          when: null,
          target: { kind: 'ENDING', endingId: 'done' },
        },
        {
          id: 'declined-done',
          fromSectionId: 'declined',
          priority: 0,
          when: null,
          target: { kind: 'ENDING', endingId: 'done' },
        },
      ],
    }
    render(
      <FormRenderer version={falseBranchVersion} mode="public" onAnswersChange={onAnswersChange} />,
    )

    const checkbox = screen.getByRole('checkbox', { name: 'Добавить контакты' })
    expect(screen.queryByRole('button', { name: 'Далее' })).not.toBeInTheDocument()
    await actor.click(checkbox)
    await actor.click(checkbox)

    await waitFor(() =>
      expect(onAnswersChange).toHaveBeenLastCalledWith({ 'details-toggle': false }),
    )
    expect(screen.getByRole('button', { name: 'Далее' })).toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: 'Сбросить черновик' }))

    await waitFor(() => expect(onAnswersChange).toHaveBeenLastCalledWith({}))
    expect(screen.queryByRole('button', { name: 'Далее' })).not.toBeInTheDocument()
  })

  it('displays datetime-local as local wall time and submits an ISO instant', async () => {
    vi.stubEnv('TZ', 'America/New_York')
    const actor = userEvent.setup()
    const onSubmit = vi.fn()
    const dateQuestion: PublicFormQuestion = {
      id: 'meeting',
      sectionId: 'fields',
      valueType: 'DATE',
      label: 'Встреча',
      required: true,
      syncWithPropertyName: false,
      input: { kind: 'DATE', includeTime: true },
    }
    render(
      <FormRenderer
        version={fieldVersion([dateQuestion])}
        mode="public"
        initialAnswers={{ meeting: '2026-01-15T12:30:00.000Z' }}
        onSubmit={onSubmit}
      />,
    )

    const input = screen.getByLabelText('Встреча *')
    expect(input).toHaveValue('2026-01-15T07:30')
    fireEvent.change(input, { target: { value: '2026-01-15T09:45' } })
    await actor.click(screen.getByRole('button', { name: 'Отправить заявку' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        answers: { meeting: '2026-01-15T14:45:00.000Z' },
      }),
    )
  })

  it('uses safe public validation copy for unknown server codes', async () => {
    render(
      <FormRenderer
        version={version}
        mode="public"
        serverFieldErrors={{ name: ['INTERNAL_DATABASE_DETAIL_123'] }}
      />,
    )

    expect(await screen.findByText('Проверьте значение поля')).toBeInTheDocument()
    expect(screen.queryByText('INTERNAL_DATABASE_DETAIL_123')).not.toBeInTheDocument()
  })

  it('focuses the first real radio when a required choice is empty', async () => {
    const actor = userEvent.setup()
    const radioQuestion: PublicFormQuestion = {
      id: 'radio',
      sectionId: 'fields',
      valueType: 'SELECT',
      label: 'Формат',
      required: true,
      syncWithPropertyName: false,
      input: {
        kind: 'SINGLE_CHOICE',
        appearance: 'RADIO',
        options: [
          { id: 'online', label: 'Онлайн' },
          { id: 'office', label: 'В офисе' },
        ],
      },
    }
    render(<FormRenderer version={fieldVersion([radioQuestion])} mode="public" />)

    await actor.click(screen.getByRole('button', { name: 'Отправить заявку' }))

    expect(await screen.findByText('Заполните обязательное поле')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Онлайн' })).toHaveFocus()
  })

  it('focuses the first real checkbox when a required checklist is empty', async () => {
    const actor = userEvent.setup()
    const checklistQuestion: PublicFormQuestion = {
      id: 'checklist',
      sectionId: 'fields',
      valueType: 'MULTI_SELECT',
      label: 'Темы',
      required: true,
      syncWithPropertyName: false,
      input: {
        kind: 'MULTI_CHOICE',
        appearance: 'CHECKLIST',
        options: [
          { id: 'product', label: 'Продукт' },
          { id: 'support', label: 'Поддержка' },
        ],
        maxSelections: 2,
      },
    }
    render(<FormRenderer version={fieldVersion([checklistQuestion])} mode="public" />)

    await actor.click(screen.getByRole('button', { name: 'Отправить заявку' }))

    expect(await screen.findByText('Заполните обязательное поле')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Продукт' })).toHaveFocus()
  })

  it('focuses the list search and announces its description or error with zero matches', async () => {
    const actor = userEvent.setup()
    const listQuestion: PublicFormQuestion = {
      id: 'list',
      sectionId: 'fields',
      valueType: 'SELECT',
      label: 'Город',
      description: 'Выберите город проведения',
      required: true,
      syncWithPropertyName: false,
      input: {
        kind: 'SINGLE_CHOICE',
        appearance: 'LIST',
        options: [
          { id: 'moscow', label: 'Москва' },
          { id: 'kazan', label: 'Казань' },
        ],
      },
    }
    render(<FormRenderer version={fieldVersion([listQuestion])} mode="public" />)

    const search = screen.getByRole('combobox', { name: 'Поиск: Город' })
    const helperId = search.getAttribute('aria-describedby')
    const listboxId = search.getAttribute('aria-controls')
    expect(helperId).toBeTruthy()
    expect(listboxId).toBeTruthy()
    expect(document.getElementById(listboxId!)).toHaveAttribute('role', 'listbox')
    expect(search).toHaveAccessibleDescription('Выберите город проведения')
    await actor.type(search, 'Нет совпадений')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: 'Отправить заявку' }))

    expect(await screen.findByText('Заполните обязательное поле')).toBeInTheDocument()
    expect(search).toHaveFocus()
    expect(search).toHaveAttribute('aria-describedby', helperId)
    expect(search).toHaveAccessibleDescription('Заполните обязательное поле')
    expect(search).toHaveAttribute('aria-controls', listboxId)
  })

  it('focuses the multi-picker search and announces its description or error with zero matches', async () => {
    const actor = userEvent.setup()
    const pickerQuestion: PublicFormQuestion = {
      id: 'picker',
      sectionId: 'fields',
      valueType: 'MULTI_SELECT',
      label: 'Темы',
      description: 'Можно выбрать несколько тем',
      required: true,
      syncWithPropertyName: false,
      input: {
        kind: 'MULTI_CHOICE',
        appearance: 'MULTI_PICKER',
        options: [
          { id: 'product', label: 'Продукт' },
          { id: 'support', label: 'Поддержка' },
        ],
        maxSelections: 2,
      },
    }
    render(<FormRenderer version={fieldVersion([pickerQuestion])} mode="public" />)

    const search = screen.getByRole('combobox', { name: 'Поиск: Темы' })
    const helperId = search.getAttribute('aria-describedby')
    const listboxId = search.getAttribute('aria-controls')
    expect(helperId).toBeTruthy()
    expect(listboxId).toBeTruthy()
    expect(document.getElementById(listboxId!)).toHaveAttribute('role', 'listbox')
    expect(search).toHaveAccessibleDescription('Можно выбрать несколько тем')
    await actor.type(search, 'Нет совпадений')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: 'Отправить заявку' }))

    expect(await screen.findByText('Заполните обязательное поле')).toBeInTheDocument()
    expect(search).toHaveFocus()
    expect(search).toHaveAttribute('aria-describedby', helperId)
    expect(search).toHaveAccessibleDescription('Заполните обязательное поле')
    expect(search).toHaveAttribute('aria-controls', listboxId)
  })

  it('keeps restored choices beyond the first 100 visible and removable', async () => {
    const actor = userEvent.setup()
    const onAnswersChange = vi.fn()
    const options = Array.from({ length: 150 }, (_, index) => ({
      id: `option-${index + 1}`,
      label: `Вариант ${index + 1}`,
    }))
    const listQuestion: PublicFormQuestion = {
      id: 'long-list',
      sectionId: 'fields',
      valueType: 'SELECT',
      label: 'Один вариант',
      required: false,
      syncWithPropertyName: false,
      input: { kind: 'SINGLE_CHOICE', appearance: 'LIST', options },
    }
    const pickerQuestion: PublicFormQuestion = {
      id: 'long-picker',
      sectionId: 'fields',
      valueType: 'MULTI_SELECT',
      label: 'Несколько вариантов',
      required: false,
      syncWithPropertyName: false,
      input: {
        kind: 'MULTI_CHOICE',
        appearance: 'MULTI_PICKER',
        options,
        maxSelections: 10,
      },
    }
    render(
      <FormRenderer
        version={fieldVersion([listQuestion, pickerQuestion])}
        mode="public"
        initialAnswers={{ 'long-list': 'option-121', 'long-picker': ['option-122'] }}
        onAnswersChange={onAnswersChange}
      />,
    )

    const restoredSingle = screen.getByRole('option', { name: 'Вариант 121' })
    const restoredMulti = screen.getByRole('checkbox', { name: 'Вариант 122' })
    expect(restoredSingle).toHaveAttribute('aria-selected', 'true')
    expect(restoredMulti).toBeChecked()

    await actor.click(restoredSingle)
    await actor.click(restoredMulti)

    await waitFor(() => expect(onAnswersChange).toHaveBeenLastCalledWith({}))
    expect(screen.queryByRole('option', { name: 'Вариант 121' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Вариант 122' })).not.toBeInTheDocument()
  })

  it('renders distinct and bounded choice appearances', () => {
    const option = (id: string, label: string) => ({ id, label })
    const single = (
      id: string,
      label: string,
      appearance: 'RADIO' | 'LIST' | 'DROPDOWN',
    ): PublicFormQuestion => ({
      id,
      sectionId: 'fields',
      valueType: 'SELECT',
      label,
      required: false,
      syncWithPropertyName: false,
      input: { kind: 'SINGLE_CHOICE', appearance, options: [option(`${id}-1`, 'Первый')] },
    })
    const multi = (
      id: string,
      label: string,
      appearance: 'CHECKLIST' | 'MULTI_PICKER',
    ): PublicFormQuestion => ({
      id,
      sectionId: 'fields',
      valueType: 'MULTI_SELECT',
      label,
      required: false,
      syncWithPropertyName: false,
      input: {
        kind: 'MULTI_CHOICE',
        appearance,
        options: [option(`${id}-1`, `${label} 1`), option(`${id}-2`, `${label} 2`)],
        maxSelections: 2,
      },
    })
    render(
      <FormRenderer
        version={fieldVersion([
          single('radio', 'Радио', 'RADIO'),
          single('list', 'Список', 'LIST'),
          single('dropdown', 'Выпадающий список', 'DROPDOWN'),
          multi('checklist', 'Чеклист', 'CHECKLIST'),
          multi('picker', 'Компактный выбор', 'MULTI_PICKER'),
        ])}
        mode="public"
      />,
    )

    expect(screen.getByRole('radiogroup', { name: 'Радио' })).toBeInTheDocument()
    expect(screen.getByRole('listbox', { name: 'Список' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Поиск: Список' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Выпадающий список' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Чеклист 1' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Поиск: Чеклист' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Поиск: Компактный выбор' })).toBeInTheDocument()
  })
})
