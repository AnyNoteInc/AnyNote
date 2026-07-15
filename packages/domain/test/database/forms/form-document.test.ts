import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  FORM_PROPERTY_TYPES,
  FORM_SCHEMA_VERSION,
  MAX_FORM_CONDITION_DEPTH,
  MAX_FORM_DOCUMENT_BYTES,
  MAX_FORM_QUESTIONS,
  formConditionGroupSchema,
  formConditionSchema,
  formInputConfigSchema,
  formPropertyTypeSchema,
  formVersionDocumentSchema,
  parseFormVersionDocument,
  type FormCondition,
  type FormConditionGroup,
  type FormInputConfig,
  type FormVersionDocument,
} from '../../../src/database/forms/public.ts'

const makeDocument = (): FormVersionDocument => ({
  schemaVersion: FORM_SCHEMA_VERSION,
  firstSectionId: 'section-1',
  presentation: {
    title: 'Contact us',
    submitButtonText: 'Submit',
    hideAnyNoteBranding: false,
  },
  sections: [
    {
      id: 'section-1',
      title: 'Contact',
      questionIds: ['question-1'],
    },
  ],
  questions: [
    {
      id: 'question-1',
      sectionId: 'section-1',
      property: { kind: 'TITLE' },
      label: 'Your name',
      required: true,
      syncWithPropertyName: false,
      input: {
        kind: 'TEXT',
        multiline: false,
        maxLength: 200,
      },
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
  endings: [{ id: 'ending-1', title: 'Thank you' }],
})

const makeConditionGroup = (depth: number): FormConditionGroup => {
  let group: FormConditionGroup = {
    kind: 'ALL',
    members: [{ kind: 'TEXT_EQUALS', questionId: 'question-1', value: 'yes' }],
  }

  for (let currentDepth = 1; currentDepth < depth; currentDepth += 1) {
    group = { kind: 'ANY', members: [group] }
  }

  return group
}

describe('database form document', () => {
  it('accepts a complete schema-version-1 document', () => {
    const document = makeDocument()

    expect(formVersionDocumentSchema.parse(document)).toEqual(document)
    expect(parseFormVersionDocument(document)).toEqual(document)
  })

  it('rejects more than the maximum number of questions', () => {
    const document = makeDocument()
    document.questions = Array.from({ length: MAX_FORM_QUESTIONS + 1 }, (_, index) => ({
      ...document.questions[0]!,
      id: `question-${index}`,
    }))

    expect(formVersionDocumentSchema.safeParse(document).success).toBe(false)
  })

  it('exposes every supported property type without depending on Prisma', () => {
    expect(FORM_PROPERTY_TYPES).toEqual([
      'TEXT',
      'NUMBER',
      'STATUS',
      'SELECT',
      'MULTI_SELECT',
      'CHECKBOX',
      'DATE',
      'PERSON',
      'FILE',
      'URL',
      'EMAIL',
      'PHONE',
      'RELATION',
      'PAGE_LINK',
    ])

    for (const propertyType of FORM_PROPERTY_TYPES) {
      expect(formPropertyTypeSchema.parse(propertyType)).toBe(propertyType)
    }
  })

  it('accepts every input configuration variant', () => {
    const inputs: FormInputConfig[] = [
      { kind: 'TEXT', multiline: false, minLength: 1, maxLength: 200 },
      { kind: 'NUMBER', min: 0, max: 10, step: 1 },
      {
        kind: 'SINGLE_CHOICE',
        appearance: 'RADIO',
        options: [{ id: 'yes', label: 'Yes', color: 'green' }],
      },
      {
        kind: 'MULTI_CHOICE',
        appearance: 'CHECKLIST',
        options: [{ id: 'one', label: 'One' }],
        minSelections: 0,
        maxSelections: 1,
      },
      { kind: 'CHECKBOX', consent: true },
      { kind: 'DATE', includeTime: true },
      { kind: 'URL' },
      { kind: 'EMAIL' },
      { kind: 'PHONE' },
      {
        kind: 'FILE',
        allowedMimeTypes: ['image/png'],
        maxBytesPerFile: 5_000_000,
        maxFiles: 3,
      },
      { kind: 'PERSON', maxSelections: 2 },
      { kind: 'RELATION', maxSelections: 2 },
      { kind: 'PAGE_LINK' },
    ]

    for (const input of inputs) {
      expect(formInputConfigSchema.parse(input)).toEqual(input)
    }
  })

  it('enforces local ID and text bounds', () => {
    const emptyId = makeDocument()
    emptyId.sections[0]!.id = ''

    const longId = makeDocument()
    longId.questions[0]!.id = 'q'.repeat(65)

    const longTitle = makeDocument()
    longTitle.presentation.title = 't'.repeat(201)

    expect(formVersionDocumentSchema.safeParse(emptyId).success).toBe(false)
    expect(formVersionDocumentSchema.safeParse(longId).success).toBe(false)
    expect(formVersionDocumentSchema.safeParse(longTitle).success).toBe(false)
  })

  it('enforces finite and internally consistent input bounds', () => {
    expect(
      formInputConfigSchema.safeParse({
        kind: 'NUMBER',
        min: 0,
        max: 10,
        step: Number.POSITIVE_INFINITY,
      }).success,
    ).toBe(false)
    expect(
      formInputConfigSchema.safeParse({
        kind: 'NUMBER',
        min: 10,
        max: 1,
        step: 1,
      }).success,
    ).toBe(false)
    expect(
      formInputConfigSchema.safeParse({
        kind: 'TEXT',
        multiline: false,
        minLength: 10,
        maxLength: 5,
      }).success,
    ).toBe(false)
    expect(
      formInputConfigSchema.safeParse({
        kind: 'MULTI_CHOICE',
        appearance: 'MULTI_PICKER',
        options: [{ id: 'one', label: 'One' }],
        minSelections: 2,
        maxSelections: 1,
      }).success,
    ).toBe(false)
    expect(
      formInputConfigSchema.safeParse({
        kind: 'MULTI_CHOICE',
        appearance: 'MULTI_PICKER',
        options: [{ id: 'one', label: 'One' }],
        minSelections: 0,
        maxSelections: 2,
      }).success,
    ).toBe(false)
  })

  it('accepts condition depth 8 and rejects depth 9', () => {
    expect(
      formConditionGroupSchema.safeParse(makeConditionGroup(MAX_FORM_CONDITION_DEPTH)).success,
    ).toBe(true)
    expect(
      formConditionGroupSchema.safeParse(makeConditionGroup(MAX_FORM_CONDITION_DEPTH + 1)).success,
    ).toBe(false)
  })

  it('validates every typed condition operator', () => {
    const conditions: FormCondition[] = [
      { kind: 'IS_EMPTY', questionId: 'question-1' },
      { kind: 'IS_NOT_EMPTY', questionId: 'question-1' },
      { kind: 'TEXT_EQUALS', questionId: 'question-1', value: 'yes' },
      { kind: 'TEXT_NOT_EQUALS', questionId: 'question-1', value: 'no' },
      { kind: 'TEXT_CONTAINS', questionId: 'question-1', value: 'es' },
      { kind: 'TEXT_NOT_CONTAINS', questionId: 'question-1', value: 'no' },
      { kind: 'NUMBER_EQUALS', questionId: 'question-1', value: 10 },
      { kind: 'NUMBER_NOT_EQUALS', questionId: 'question-1', value: 11 },
      { kind: 'NUMBER_GREATER_THAN', questionId: 'question-1', value: 9 },
      { kind: 'NUMBER_GREATER_THAN_OR_EQUAL', questionId: 'question-1', value: 10 },
      { kind: 'NUMBER_LESS_THAN', questionId: 'question-1', value: 11 },
      { kind: 'NUMBER_LESS_THAN_OR_EQUAL', questionId: 'question-1', value: 10 },
      { kind: 'DATE_BEFORE', questionId: 'question-1', value: '2026-07-16T00:00:00Z' },
      { kind: 'DATE_AFTER', questionId: 'question-1', value: '2026-07-14T00:00:00Z' },
      { kind: 'DATE_ON', questionId: 'question-1', value: '2026-07-15T00:00:00Z' },
      { kind: 'CHECKBOX_IS', questionId: 'question-1', value: true },
      { kind: 'OPTION_IS', questionId: 'question-1', optionId: 'option-1' },
      { kind: 'OPTION_IS_NOT', questionId: 'question-1', optionId: 'option-2' },
      { kind: 'OPTION_CONTAINS', questionId: 'question-1', optionId: 'option-1' },
      { kind: 'OPTION_NOT_CONTAINS', questionId: 'question-1', optionId: 'option-2' },
    ]

    for (const condition of conditions) {
      expect(formConditionSchema.parse(condition)).toEqual(condition)
    }

    expect(
      formConditionSchema.safeParse({
        kind: 'NUMBER_GREATER_THAN',
        questionId: 'question-1',
        value: '10',
      }).success,
    ).toBe(false)
    expect(
      formConditionSchema.safeParse({
        kind: 'OPTION_CONTAINS',
        questionId: 'question-1',
        optionId: '',
      }).success,
    ).toBe(false)
  })

  it.each([
    ['/database/forms', true],
    ['/?from=form', true],
    ['/thank%20you', true],
    ['https://anynote.ru/thanks', true],
    ['https://example.com/thanks?source=anynote', true],
    ['https://example.com/thank%20you', true],
    ['//evil.example/steal', false],
    ['http://example.com', false],
    ['javascript:alert(1)', false],
    ['data:text/html,unsafe', false],
    ['https:/malformed.example', false],
    ['https://user:password@example.com', false],
    ['\u0000https://example.com', false],
    ['https://exa\tmple.com', false],
    ['https://example.com\n', false],
    ['https://example.com/\u007f', false],
    ['https://example.com/%ZZ', false],
    ['/thanks%', false],
    ['/thanks%G0', false],
    ['/thanks%0', false],
    [' https://example.com', false],
    ['https://example.com ', false],
    ['not a url', false],
  ])('validates ending redirect %s', (href, accepted) => {
    const document = makeDocument()
    document.endings[0]!.button = { label: 'Continue', href }

    expect(formVersionDocumentSchema.safeParse(document).success).toBe(accepted)
  })

  it('rejects oversized raw JSON without retaining its contents in the error', () => {
    const secretMarker = 'FORM_SECRET_MARKER_8f1b7f'
    const document = makeDocument()
    document.endings = Array.from({ length: 60 }, (_, index) => ({
      id: `ending-${index}`,
      title: 'Complete',
      body: `${index === 0 ? secretMarker : ''}${'x'.repeat(9_950)}`,
    }))

    expect(new TextEncoder().encode(JSON.stringify(document)).byteLength).toBeGreaterThan(
      MAX_FORM_DOCUMENT_BYTES,
    )
    expect(formVersionDocumentSchema.safeParse(document).success).toBe(true)

    let error: unknown
    try {
      parseFormVersionDocument(document)
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
  })

  it('rejects a huge question array before Zod traverses its elements', () => {
    const traversalTrap: Record<string, unknown> = { padding: '1234567890' }
    Object.defineProperty(traversalTrap, 'id', {
      enumerable: false,
      get: () => {
        throw new Error('ZOD_DEEP_TRAVERSAL_REACHED')
      },
    })
    const rawDocument = {
      ...makeDocument(),
      questions: Array.from({ length: 100_000 }, () => traversalTrap),
    }

    expect(() => parseFormVersionDocument(rawDocument)).toThrowError(
      expect.objectContaining({
        issues: [expect.objectContaining({ message: 'FORM_DOCUMENT_TOO_LARGE', path: [] })],
      }),
    )
  })

  it('returns Zod validation errors when preflight serialization is unavailable', () => {
    const circularInput: Record<string, unknown> = {}
    circularInput.self = circularInput

    expect(() => parseFormVersionDocument(undefined)).toThrow(z.ZodError)
    expect(() => parseFormVersionDocument(1n)).toThrow(z.ZodError)
    expect(() => parseFormVersionDocument(circularInput)).toThrow(z.ZodError)
  })

  it('keeps the canonical size check after schema parsing', () => {
    const document = makeDocument()
    document.endings = Array.from({ length: 60 }, (_, index) => {
      const ending = { id: `ending-${index}`, title: 'Complete' }
      Object.defineProperty(ending, 'body', {
        enumerable: false,
        value: 'x'.repeat(10_000),
      })
      return ending
    })

    expect(new TextEncoder().encode(JSON.stringify(document)).byteLength).toBeLessThan(
      MAX_FORM_DOCUMENT_BYTES,
    )
    const parsedDocument = formVersionDocumentSchema.parse(document)
    expect(new TextEncoder().encode(JSON.stringify(parsedDocument)).byteLength).toBeGreaterThan(
      MAX_FORM_DOCUMENT_BYTES,
    )
    expect(() => parseFormVersionDocument(document)).toThrowError(
      expect.objectContaining({
        issues: [expect.objectContaining({ message: 'FORM_DOCUMENT_TOO_LARGE', path: [] })],
      }),
    )
  })
})
