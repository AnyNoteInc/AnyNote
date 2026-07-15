import { describe, expect, it } from 'vitest'

import {
  FORM_SCHEMA_VERSION,
  buildFormAnswerSchema,
  buildQuestionValueSchema,
  projectReachableAnswers,
  toPublicFormVersion,
  type FormInputConfig,
  type FormQuestion,
  type FormVersionDocument,
  type PublicFormQuestion,
  type PublicFormVersion,
} from '../../../src/database/forms/public.ts'

const publicQuestion = (
  id: string,
  valueType: PublicFormQuestion['valueType'],
  input: FormInputConfig,
  overrides: Partial<PublicFormQuestion> = {},
): PublicFormQuestion => ({
  id,
  sectionId: 'section-1',
  label: `Public ${id}`,
  required: false,
  syncWithPropertyName: false,
  valueType,
  input,
  ...overrides,
})

const makePublicVersion = (questions: PublicFormQuestion[]): PublicFormVersion => ({
  schemaVersion: FORM_SCHEMA_VERSION,
  firstSectionId: 'section-1',
  presentation: {
    title: 'Public form',
    submitButtonText: 'Submit',
    hideAnyNoteBranding: false,
  },
  sections: [{ id: 'section-1', title: 'Questions', questionIds: questions.map(({ id }) => id) }],
  questions,
  transitions: [
    {
      id: 'transition-1',
      fromSectionId: 'section-1',
      priority: 0,
      when: null,
      target: { kind: 'ENDING', endingId: 'ending-default' },
    },
  ],
  endings: [{ id: 'ending-default', title: 'Done' }],
})

const expectValid = (question: PublicFormQuestion, value: unknown) => {
  expect(buildQuestionValueSchema(question).safeParse(value).success).toBe(true)
}

const expectInvalid = (question: PublicFormQuestion, value: unknown) => {
  expect(buildQuestionValueSchema(question).safeParse(value).success).toBe(false)
}

const expectAnswerIssue = (
  version: PublicFormVersion,
  answers: Record<string, unknown>,
  questionId: string,
  message?: string,
) => {
  const result = buildFormAnswerSchema(version).safeParse({ answers })
  expect(result.success).toBe(false)
  if (result.success) return

  const issue = result.error.issues.find(
    (candidate) => candidate.path[0] === 'answers' && candidate.path[1] === questionId,
  )
  expect(issue).toBeDefined()
  if (message !== undefined) expect(issue?.message).toBe(message)
  expect(JSON.stringify(result.error.issues)).not.toContain('Public ')
}

describe('buildQuestionValueSchema', () => {
  it('validates text, required and optional empty semantics', () => {
    const optional = publicQuestion('text', 'TEXT', {
      kind: 'TEXT',
      multiline: false,
      minLength: 2,
      maxLength: 5,
    })
    expectValid(optional, undefined)
    expectValid(optional, null)
    expectValid(optional, '')
    expectValid(optional, 'okay')
    expectInvalid(optional, 'x')
    expectInvalid(optional, 'too long')

    const required = { ...optional, required: true }
    expectInvalid(required, undefined)
    expectInvalid(required, null)
    expectInvalid(required, '')
  })

  it('validates finite numbers, bounds and floating-point steps', () => {
    const question = publicQuestion('number', 'NUMBER', {
      kind: 'NUMBER',
      min: 0.1,
      max: 2,
      step: 0.1,
    })
    expectValid(question, 0.3)
    expectInvalid(question, Number.POSITIVE_INFINITY)
    expectInvalid(question, 2.1)
    expectInvalid(question, 0.35)
  })

  it('validates single and multiple choice option IDs and selection bounds', () => {
    const single = publicQuestion('single', 'SELECT', {
      kind: 'SINGLE_CHOICE',
      appearance: 'RADIO',
      options: [
        { id: 'option-a', label: 'A' },
        { id: 'option-b', label: 'B' },
      ],
    })
    expectValid(single, 'option-a')
    expectInvalid(single, 'missing')

    const multiple = publicQuestion('multiple', 'MULTI_SELECT', {
      kind: 'MULTI_CHOICE',
      appearance: 'CHECKLIST',
      options: [
        { id: 'option-a', label: 'A' },
        { id: 'option-b', label: 'B' },
        { id: 'option-c', label: 'C' },
      ],
      minSelections: 2,
      maxSelections: 2,
    })
    expectValid(multiple, ['option-a', 'option-b'])
    expectInvalid(multiple, ['option-a'])
    expectInvalid(multiple, ['option-a', 'option-a'])
    expectInvalid(multiple, ['option-a', 'missing'])
    expectInvalid(multiple, ['option-a', 'option-b', 'option-c'])
  })

  it('validates checkbox values and required consent', () => {
    const checkbox = publicQuestion('checkbox', 'CHECKBOX', {
      kind: 'CHECKBOX',
      consent: false,
    })
    expectValid(checkbox, false)
    expectValid(checkbox, true)
    expectInvalid(checkbox, 'true')

    const consent = publicQuestion(
      'consent',
      'CHECKBOX',
      { kind: 'CHECKBOX', consent: true },
      { required: true },
    )
    expectInvalid(consent, false)
    expectValid(consent, true)
  })

  it('validates dates and offset date-times according to includeTime', () => {
    const date = publicQuestion('date', 'DATE', { kind: 'DATE', includeTime: false })
    expectValid(date, '2026-07-15')
    expectInvalid(date, '2026-02-30')
    expectInvalid(date, '2026-07-15T12:00:00+03:00')

    const dateTime = publicQuestion('date-time', 'DATE', { kind: 'DATE', includeTime: true })
    expectValid(dateTime, '2026-07-15T12:00:00+03:00')
    expectInvalid(dateTime, '2026-07-15T12:00:00')
    expectInvalid(dateTime, '2026-07-15')
  })

  it('validates bounded HTTP(S) URLs, emails and conservative phone numbers', () => {
    const url = publicQuestion('url', 'URL', { kind: 'URL' })
    expectValid(url, 'https://anynote.ru/forms?q=1')
    expectValid(url, 'http://localhost:3000/form')
    expectInvalid(url, 'javascript:alert(1)')
    expectInvalid(url, `https://example.com/${'x'.repeat(2_100)}`)

    const email = publicQuestion('email', 'EMAIL', { kind: 'EMAIL' })
    expectValid(email, 'person@example.com')
    expectInvalid(email, 'not-an-email')

    const phone = publicQuestion('phone', 'PHONE', { kind: 'PHONE' })
    expectValid(phone, '+7 (999) 123-45-67')
    expectInvalid(phone, 'call-me-maybe')
    expectInvalid(phone, '123')
  })

  it('validates leased upload tokens, count and uniqueness without accepting raw values', () => {
    const file = publicQuestion('file', 'FILE', {
      kind: 'FILE',
      allowedMimeTypes: ['image/png'],
      maxBytesPerFile: 1_000,
      maxFiles: 2,
    })
    expectValid(file, ['lease-token.abc', 'lease-token.def'])
    expectInvalid(file, 'file-id')
    expectInvalid(file, [''])
    expectInvalid(file, ['x'.repeat(4_097)])
    expectInvalid(file, ['lease-token.abc', 'lease-token.abc'])
    expectInvalid(file, ['a', 'b', 'c'])
  })

  it('validates bounded unique opaque IDs for person, relation and page link pickers', () => {
    const person = publicQuestion('person', 'PERSON', {
      kind: 'PERSON',
      maxSelections: 2,
    })
    expectValid(person, ['member-1', 'member-2'])
    expectInvalid(person, ['member-1', 'member-1'])
    expectInvalid(person, ['member-1', 'member-2', 'member-3'])

    const relation = publicQuestion('relation', 'RELATION', {
      kind: 'RELATION',
      maxSelections: 1,
    })
    expectValid(relation, ['row-1'])
    expectInvalid(relation, ['row-1', 'row-2'])

    const pageLink = publicQuestion('page-link', 'PAGE_LINK', { kind: 'PAGE_LINK' })
    expectValid(pageLink, 'page-1')
    expectInvalid(pageLink, ['page-1'])
    expectInvalid(pageLink, ' ')
  })
})

describe('buildFormAnswerSchema', () => {
  it('puts required and value errors at answers.questionId and exposes no label or property details', () => {
    const required = publicQuestion(
      'question-public-id',
      'TEXT',
      { kind: 'TEXT', multiline: false, maxLength: 3 },
      { required: true, label: 'Hidden property name' },
    )
    const version = makePublicVersion([required])

    expectAnswerIssue(version, {}, 'question-public-id', 'REQUIRED_ANSWER')
    expectAnswerIssue(version, { 'question-public-id': 'long' }, 'question-public-id')

    const result = buildFormAnswerSchema(version).safeParse({ answers: {} })
    expect(JSON.stringify(result)).not.toContain('Hidden property name')
  })

  it('rejects unknown, unreachable and visibleWhen-hidden answers by public question ID', () => {
    const trigger = publicQuestion('trigger', 'TEXT', {
      kind: 'TEXT',
      multiline: false,
      maxLength: 20,
    })
    const hidden = publicQuestion(
      'hidden',
      'TEXT',
      { kind: 'TEXT', multiline: false, maxLength: 20 },
      {
        visibleWhen: {
          kind: 'ALL',
          members: [{ kind: 'TEXT_EQUALS', questionId: 'trigger', value: 'show' }],
        },
      },
    )
    const later = publicQuestion('later', 'TEXT', {
      kind: 'TEXT',
      multiline: false,
      maxLength: 20,
    })
    const version = makePublicVersion([trigger, hidden])
    version.sections.push({ id: 'section-2', title: 'Later', questionIds: ['later'] })
    version.questions.push({ ...later, sectionId: 'section-2' })
    version.transitions = [
      {
        id: 'skip-later',
        fromSectionId: 'section-1',
        priority: 0,
        when: {
          kind: 'ALL',
          members: [{ kind: 'TEXT_EQUALS', questionId: 'trigger', value: 'skip' }],
        },
        target: { kind: 'ENDING', endingId: 'ending-default' },
      },
      {
        id: 'visit-later',
        fromSectionId: 'section-1',
        priority: 1,
        when: null,
        target: { kind: 'SECTION', sectionId: 'section-2' },
      },
      {
        id: 'finish',
        fromSectionId: 'section-2',
        priority: 0,
        when: null,
        target: { kind: 'ENDING', endingId: 'ending-default' },
      },
    ]

    expectAnswerIssue(version, { trigger: 'skip', unknown: 'x' }, 'unknown', 'UNREACHABLE_ANSWER')
    expectAnswerIssue(version, { trigger: 'skip', later: 'x' }, 'later', 'UNREACHABLE_ANSWER')
    expectAnswerIssue(version, { trigger: 'hide', hidden: 'x' }, 'hidden', 'UNREACHABLE_ANSWER')
    expect(
      buildFormAnswerSchema(version).safeParse({ answers: { trigger: 'show', hidden: 'x' } })
        .success,
    ).toBe(true)
  })

  it('accepts only an answer envelope and rejects extra top-level data', () => {
    const version = makePublicVersion([])
    expect(buildFormAnswerSchema(version).safeParse({ answers: {} }).success).toBe(true)
    expect(
      buildFormAnswerSchema(version).safeParse({ answers: {}, sourceId: 'secret' }).success,
    ).toBe(false)
  })
})

describe('projectReachableAnswers', () => {
  it('removes answers that become unreachable after an earlier answer changes', () => {
    const trigger = publicQuestion('trigger', 'TEXT', {
      kind: 'TEXT',
      multiline: false,
      maxLength: 20,
    })
    const conditional = publicQuestion(
      'conditional',
      'TEXT',
      { kind: 'TEXT', multiline: false, maxLength: 20 },
      {
        visibleWhen: {
          kind: 'ALL',
          members: [{ kind: 'TEXT_EQUALS', questionId: 'trigger', value: 'yes' }],
        },
      },
    )
    const version = makePublicVersion([trigger, conditional])

    expect(
      projectReachableAnswers(version, {
        trigger: 'no',
        conditional: 'stale',
        unknown: 'stale',
      }),
    ).toEqual({ trigger: 'no' })
  })
})

describe('toPublicFormVersion', () => {
  const storedQuestion = (
    id: string,
    property: FormQuestion['property'],
    input: FormInputConfig,
  ): FormQuestion => ({
    id,
    sectionId: 'section-1',
    property,
    label: `Question ${id}`,
    required: false,
    syncWithPropertyName: false,
    input,
  })

  it('maps property refs to valueType and serializes an exact secret-free DTO', () => {
    const stored: FormVersionDocument & Record<string, unknown> = {
      schemaVersion: FORM_SCHEMA_VERSION,
      firstSectionId: 'section-1',
      presentation: {
        title: 'Safe title',
        submitButtonText: 'Submit',
        hideAnyNoteBranding: false,
      },
      sections: [
        { id: 'section-1', title: 'Questions', questionIds: ['title-question', 'email-question'] },
      ],
      questions: [
        storedQuestion(
          'title-question',
          { kind: 'TITLE' },
          {
            kind: 'TEXT',
            multiline: false,
            maxLength: 100,
          },
        ),
        storedQuestion(
          'email-question',
          {
            kind: 'PROPERTY',
            propertyId: 'secret-property-id',
            propertyType: 'EMAIL',
          },
          { kind: 'EMAIL' },
        ),
      ],
      transitions: [
        {
          id: 'finish',
          fromSectionId: 'section-1',
          priority: 0,
          when: null,
          target: { kind: 'ENDING', endingId: 'ending-default' },
        },
      ],
      endings: [{ id: 'ending-default', title: 'Done' }],
      sourceId: 'secret-source-id',
      pageId: 'secret-page-id',
      hiddenPropertyName: 'Hidden salary property',
    }

    const publicVersion = toPublicFormVersion(stored)
    expect(publicVersion.questions.map(({ valueType }) => valueType)).toEqual(['TITLE', 'EMAIL'])
    expect(Object.keys(publicVersion).sort()).toEqual(
      [
        'endings',
        'firstSectionId',
        'presentation',
        'questions',
        'schemaVersion',
        'sections',
        'transitions',
      ].sort(),
    )

    const serialized = JSON.stringify(publicVersion)
    for (const forbidden of [
      'propertyId',
      'secret-property-id',
      'sourceId',
      'secret-source-id',
      'pageId',
      'secret-page-id',
      'Hidden salary property',
      '"property"',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })
})
