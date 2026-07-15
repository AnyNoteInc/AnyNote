import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  FORM_SCHEMA_VERSION,
  MAX_FORM_DOCUMENT_BYTES,
  buildFormAnswerSchema,
  buildQuestionValueSchema,
  evaluateFormPath,
  formVersionDocumentSchema,
  parseFormVersionDocument,
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

  it('uses input-family-aware optional empty sentinels', () => {
    const number = publicQuestion('empty-number', 'NUMBER', { kind: 'NUMBER' })
    const checkbox = publicQuestion('empty-checkbox', 'CHECKBOX', {
      kind: 'CHECKBOX',
      consent: false,
    })
    const pageLink = publicQuestion('empty-page-link', 'PAGE_LINK', { kind: 'PAGE_LINK' })
    const file = publicQuestion('empty-file', 'FILE', {
      kind: 'FILE',
      allowedMimeTypes: [],
      maxBytesPerFile: 1_000,
      maxFiles: 2,
    })
    const multiple = publicQuestion('empty-multiple', 'MULTI_SELECT', {
      kind: 'MULTI_CHOICE',
      appearance: 'CHECKLIST',
      options: [{ id: 'option-a', label: 'A' }],
      maxSelections: 1,
    })
    const person = publicQuestion('empty-person', 'PERSON', {
      kind: 'PERSON',
      maxSelections: 1,
    })
    const relation = publicQuestion('empty-relation', 'RELATION', {
      kind: 'RELATION',
      maxSelections: 1,
    })

    for (const scalar of [number, checkbox, pageLink]) expectInvalid(scalar, [])
    for (const array of [file, multiple, person, relation]) expectInvalid(array, '')
    expectValid(pageLink, '')
    expectValid(file, [])

    for (const [requiredQuestion, emptyValue] of [
      [{ ...pageLink, required: true }, ''],
      [{ ...file, required: true }, []],
    ] as const) {
      const result = buildQuestionValueSchema(requiredQuestion).safeParse(emptyValue)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.map(({ message }) => message)).toContain('REQUIRED_ANSWER')
      }
    }
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

    const largeStep = publicQuestion('large-number', 'NUMBER', {
      kind: 'NUMBER',
      step: 1,
    })
    expectValid(largeStep, 1_000_000_000_000_000)
    for (const value of [
      1_000_000_000_000_000.125, 1_000_000_000_000_000.25, 1_000_000_000_000_000.5,
    ]) {
      expectInvalid(largeStep, value)
    }

    const largeDecimalStep = publicQuestion('large-decimal-number', 'NUMBER', {
      kind: 'NUMBER',
      step: 0.7,
    })
    expectValid(largeDecimalStep, 700_000_000_000)

    const offsetStep = publicQuestion('offset-number', 'NUMBER', {
      kind: 'NUMBER',
      min: 0.1,
      step: 0.2,
    })
    expectValid(offsetStep, 0.3)
    expectInvalid(offsetStep, 0.4)

    const exponentStep = publicQuestion('exponent-number', 'NUMBER', {
      kind: 'NUMBER',
      step: 1e-7,
    })
    expectValid(exponentStep, 3e-7)
    expectInvalid(exponentStep, 3.5e-7)

    const subnormalStep = publicQuestion('subnormal-number', 'NUMBER', {
      kind: 'NUMBER',
      step: Number.MIN_VALUE,
    })
    expectValid(subnormalStep, 3 * Number.MIN_VALUE)

    // MAX_VALUE is dyadic, so the factor of three makes this subnormal step a genuine
    // non-divisor while the subtraction still overflows the runtime quotient.
    const nonMultipleSubnormalStep = 3 * Number.MIN_VALUE
    expect(nonMultipleSubnormalStep).toBeGreaterThan(0)
    expect(Number.isFinite((Number.MAX_VALUE - -Number.MAX_VALUE) / nonMultipleSubnormalStep)).toBe(
      false,
    )
    const overflowingQuotient = publicQuestion('overflowing-number', 'NUMBER', {
      kind: 'NUMBER',
      min: -Number.MAX_VALUE,
      step: nonMultipleSubnormalStep,
    })
    expectInvalid(overflowingQuotient, Number.MAX_VALUE)
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
    expectValid(url, 'https://anynote.ru/forms/hello%20world')
    expectValid(url, 'http://localhost:3000/form')
    for (const invalidUrl of [
      'javascript:alert(1)',
      ' https://anynote.ru/form',
      'https://anynote.ru/form ',
      'https://anynote.ru/form\tvalue',
      'https://anynote.ru/form\nvalue',
      'https://anynote.ru/form\0value',
      'https://anynote.ru/form\u007fvalue',
      'https://anynote.ru/form%',
      'https://anynote.ru/form%2',
      'https://user:password@anynote.ru/form',
    ]) {
      expectInvalid(url, invalidUrl)
    }
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

  it('fails closed when a public valueType and input kind are incompatible', () => {
    const mismatch = publicQuestion('mismatch', 'URL', {
      kind: 'TEXT',
      multiline: false,
      maxLength: 100,
    })

    const direct = buildQuestionValueSchema(mismatch).safeParse('https://anynote.ru')
    expect(direct.success).toBe(false)
    if (!direct.success) {
      expect(direct.error.issues.map(({ message }) => message)).toContain(
        'QUESTION_INPUT_TYPE_MISMATCH',
      )
    }

    expectAnswerIssue(
      makePublicVersion([mismatch]),
      { mismatch: 'https://anynote.ru' },
      'mismatch',
      'QUESTION_INPUT_TYPE_MISMATCH',
    )

    const trigger = publicQuestion('trigger', 'TEXT', {
      kind: 'TEXT',
      multiline: false,
      maxLength: 20,
    })
    const hiddenMismatch: PublicFormQuestion = {
      ...mismatch,
      visibleWhen: {
        kind: 'ALL',
        members: [{ kind: 'TEXT_EQUALS', questionId: 'trigger', value: 'show' }],
      },
    }
    expectAnswerIssue(
      makePublicVersion([trigger, hiddenMismatch]),
      { trigger: 'hide' },
      'mismatch',
      'QUESTION_INPUT_TYPE_MISMATCH',
    )
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

  it('rejects dangerous own keys and prototype-polluted envelopes before object parsing', () => {
    const schema = buildFormAnswerSchema(makePublicVersion([]))
    const cases: Array<{ input: unknown; path: (string | number)[]; message: string }> = [
      {
        input: JSON.parse('{"answers":{},"__proto__":{"polluted":true}}'),
        path: ['__proto__'],
        message: 'DANGEROUS_OBJECT_KEY',
      },
      {
        input: JSON.parse('{"answers":{"__proto__":"polluted"}}'),
        path: ['answers', '__proto__'],
        message: 'DANGEROUS_OBJECT_KEY',
      },
      {
        input: Object.assign(Object.create({ polluted: true }), { answers: {} }),
        path: [],
        message: 'INVALID_OBJECT_PROTOTYPE',
      },
    ]

    for (const { input, path, message } of cases) {
      const result = schema.safeParse(input)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues).toContainEqual(expect.objectContaining({ path, message }))
      }
    }
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

  it('stabilizes cascading reachability changes and returns an idempotent projection', () => {
    const trigger = publicQuestion('trigger', 'TEXT', {
      kind: 'TEXT',
      multiline: false,
      maxLength: 20,
    })
    const hiddenRoute = publicQuestion(
      'hidden-route',
      'TEXT',
      { kind: 'TEXT', multiline: false, maxLength: 20 },
      {
        visibleWhen: {
          kind: 'ALL',
          members: [{ kind: 'TEXT_EQUALS', questionId: 'trigger', value: 'show' }],
        },
      },
    )
    const answerA = publicQuestion('answer-a', 'TEXT', {
      kind: 'TEXT',
      multiline: false,
      maxLength: 20,
    })
    const answerB = publicQuestion('answer-b', 'TEXT', {
      kind: 'TEXT',
      multiline: false,
      maxLength: 20,
    })
    const version = makePublicVersion([trigger, hiddenRoute])
    version.sections.push(
      { id: 'section-a', title: 'A', questionIds: ['answer-a'] },
      { id: 'section-b', title: 'B', questionIds: ['answer-b'] },
    )
    version.questions.push(
      { ...answerA, sectionId: 'section-a' },
      { ...answerB, sectionId: 'section-b' },
    )
    version.transitions = [
      {
        id: 'route-a',
        fromSectionId: 'section-1',
        priority: 0,
        when: {
          kind: 'ALL',
          members: [{ kind: 'TEXT_EQUALS', questionId: 'hidden-route', value: 'a' }],
        },
        target: { kind: 'SECTION', sectionId: 'section-a' },
      },
      {
        id: 'route-b',
        fromSectionId: 'section-1',
        priority: 1,
        when: null,
        target: { kind: 'SECTION', sectionId: 'section-b' },
      },
      {
        id: 'finish-a',
        fromSectionId: 'section-a',
        priority: 0,
        when: null,
        target: { kind: 'ENDING', endingId: 'ending-default' },
      },
      {
        id: 'finish-b',
        fromSectionId: 'section-b',
        priority: 0,
        when: null,
        target: { kind: 'ENDING', endingId: 'ending-default' },
      },
    ]
    const rawAnswers = {
      trigger: 'hide',
      'hidden-route': 'a',
      'answer-a': 'stale-a',
    }

    const projected = projectReachableAnswers(version, rawAnswers)
    expect(projected).toEqual({ trigger: 'hide' })
    expect(projectReachableAnswers(version, projected)).toEqual(projected)
    expect(evaluateFormPath(version, projected).sectionIds).toEqual(['section-1', 'section-b'])
    expectAnswerIssue(version, rawAnswers, 'answer-a', 'UNREACHABLE_ANSWER')
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

  const makeStoredVersion = (): FormVersionDocument =>
    ({
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
    }) satisfies FormVersionDocument

  it('maps property refs to valueType and serializes an exact secret-free DTO', () => {
    const stored = makeStoredVersion()

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
      'pageId',
      '"property"',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('fails closed when stored nested data contains unknown internal fields', () => {
    const mutators: Array<(stored: FormVersionDocument) => void> = [
      (stored) => {
        ;(stored.presentation as unknown as Record<string, unknown>).sourceId = 'secret-source'
      },
      (stored) => {
        ;(stored.questions[1]!.input as unknown as Record<string, unknown>).pageId = 'secret-page'
      },
      (stored) => {
        stored.questions[1]!.visibleWhen = {
          kind: 'ALL',
          members: [{ kind: 'IS_EMPTY', questionId: 'title-question' }],
        }
        ;(stored.questions[1]!.visibleWhen.members[0] as unknown as Record<string, unknown>)[
          'propertyId'
        ] = 'secret-property'
      },
      (stored) => {
        ;(stored.transitions[0] as unknown as Record<string, unknown>).secret = 'transition-secret'
      },
      (stored) => {
        ;(stored.endings[0] as unknown as Record<string, unknown>).secret = 'ending-secret'
      },
    ]

    for (const mutate of mutators) {
      const stored = makeStoredVersion()
      mutate(stored)
      expect(() => toPublicFormVersion(stored)).toThrow()
    }
  })

  it('returns independent nested objects that cannot mutate the stored document', () => {
    const stored = makeStoredVersion()
    const publicVersion = toPublicFormVersion(stored)

    expect(publicVersion.presentation).not.toBe(stored.presentation)
    expect(publicVersion.sections).not.toBe(stored.sections)
    expect(publicVersion.sections[0]).not.toBe(stored.sections[0])
    expect(publicVersion.sections[0]!.questionIds).not.toBe(stored.sections[0]!.questionIds)
    expect(publicVersion.questions).not.toBe(stored.questions)
    expect(publicVersion.questions[0]!.input).not.toBe(stored.questions[0]!.input)
    expect(publicVersion.transitions).not.toBe(stored.transitions)
    expect(publicVersion.transitions[0]!.target).not.toBe(stored.transitions[0]!.target)
    expect(publicVersion.endings).not.toBe(stored.endings)
    expect(publicVersion.endings[0]).not.toBe(stored.endings[0])

    publicVersion.presentation.title = 'Mutated public title'
    publicVersion.sections[0]!.title = 'Mutated public section'
    publicVersion.sections[0]!.questionIds.push('mutated-question')
    if (publicVersion.questions[0]!.input.kind === 'TEXT') {
      publicVersion.questions[0]!.input.maxLength = 1
    }

    expect(stored.presentation.title).toBe('Safe title')
    expect(stored.sections[0]!.title).toBe('Questions')
    expect(stored.sections[0]!.questionIds).not.toContain('mutated-question')
    expect(stored.questions[0]!.input).toMatchObject({ maxLength: 100 })
  })

  it('enforces the canonical document byte limit before sanitizing', () => {
    const secretMarker = 'SANITIZER_OVERSIZE_SECRET_4e28a7'
    const stored = makeStoredVersion()
    stored.transitions[0]!.target = { kind: 'ENDING', endingId: 'ending-0' }
    stored.endings = Array.from({ length: 60 }, (_, index) => ({
      id: `ending-${index}`,
      title: 'Complete',
      body: `${index === 0 ? secretMarker : ''}${'x'.repeat(9_950)}`,
    }))

    expect(formVersionDocumentSchema.safeParse(stored).success).toBe(true)
    expect(new TextEncoder().encode(JSON.stringify(stored)).byteLength).toBeGreaterThan(
      MAX_FORM_DOCUMENT_BYTES,
    )

    for (const parse of [parseFormVersionDocument, toPublicFormVersion]) {
      let error: unknown
      try {
        parse(stored)
      } catch (caught) {
        error = caught
      }

      expect(error).toBeInstanceOf(z.ZodError)
      if (!(error instanceof z.ZodError)) throw new Error('expected ZodError')
      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'custom',
          message: 'FORM_DOCUMENT_TOO_LARGE',
          path: [],
          input: undefined,
        }),
      ])
      expect(String(error).length).toBeLessThan(2_048)
      expect(String(error)).not.toContain(secretMarker)
    }
  })
})
