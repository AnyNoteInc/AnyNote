import { z } from 'zod'

export const FORM_SCHEMA_VERSION = 1 as const
export const MAX_FORM_SECTIONS = 100
export const MAX_FORM_QUESTIONS = 500
export const MAX_FORM_TRANSITIONS = 1_000
export const MAX_FORM_CONDITION_DEPTH = 8
export const MAX_FORM_DOCUMENT_BYTES = 512 * 1_024
export const MAX_FORM_SUBMIT_BYTES = 1_024 * 1_024

const MAX_FORM_ENDINGS = 100
const MAX_FORM_OPTIONS = 500
const MAX_FORM_CONDITION_MEMBERS = 100
const MAX_FORM_TEXT_INPUT_LENGTH = 100_000
const MAX_FORM_FILES = 100
const MAX_FORM_FILE_BYTES = 100 * 1_024 * 1_024
const MAX_FORM_MIME_TYPES = 100

const shortTextSchema = z.string().min(1).max(200)
const descriptionSchema = z.string().max(4_000)
const longTextSchema = z.string().max(10_000)
const colorSchema = z.string().min(1).max(128)

export const formLocalIdSchema = z.string().min(1).max(64)

export const FORM_PROPERTY_TYPES = [
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
] as const

export const formPropertyTypeSchema = z.enum(FORM_PROPERTY_TYPES)
export type FormPropertyType = z.infer<typeof formPropertyTypeSchema>

const formCoverColorSchema = z
  .object({ kind: z.literal('color'), value: z.string().min(1).max(128) })
  .strict()
const formCoverGradientSchema = z
  .object({ kind: z.literal('gradient'), value: z.string().min(1).max(512) })
  .strict()
const formCoverImageSchema = z
  .object({ kind: z.literal('image'), value: z.string().min(1).max(2_048) })
  .strict()

export const formCoverSchema = z.discriminatedUnion('kind', [
  formCoverColorSchema,
  formCoverGradientSchema,
  formCoverImageSchema,
])
export type FormCover = z.infer<typeof formCoverSchema>

export const formPresentationSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: descriptionSchema.optional(),
    icon: z.string().min(1).max(256).optional(),
    cover: formCoverSchema.optional(),
    organizationName: shortTextSchema.optional(),
    submitButtonText: z.string().min(1).max(100),
    submitButtonColor: colorSchema.optional(),
    hideAnyNoteBranding: z.boolean(),
  })
  .strict()
export type FormPresentation = z.infer<typeof formPresentationSchema>

const formTitlePropertyRefSchema = z.object({ kind: z.literal('TITLE') }).strict()
const formDatabasePropertyRefSchema = z
  .object({
    kind: z.literal('PROPERTY'),
    propertyId: formLocalIdSchema,
    propertyType: formPropertyTypeSchema,
  })
  .strict()

export const formPropertyRefSchema = z.discriminatedUnion('kind', [
  formTitlePropertyRefSchema,
  formDatabasePropertyRefSchema,
])
export type FormPropertyRef = z.infer<typeof formPropertyRefSchema>

const formSectionTargetSchema = z
  .object({ kind: z.literal('SECTION'), sectionId: formLocalIdSchema })
  .strict()
const formEndingTargetSchema = z
  .object({ kind: z.literal('ENDING'), endingId: formLocalIdSchema })
  .strict()

export const formTransitionTargetSchema = z.discriminatedUnion('kind', [
  formSectionTargetSchema,
  formEndingTargetSchema,
])
export type FormTransitionTarget = z.infer<typeof formTransitionTargetSchema>

export const formSectionSchema = z
  .object({
    id: formLocalIdSchema,
    title: z.string().min(1).max(200),
    description: descriptionSchema.optional(),
    questionIds: z.array(formLocalIdSchema).max(MAX_FORM_QUESTIONS),
  })
  .strict()
export type FormSection = z.infer<typeof formSectionSchema>

export const formOptionSnapshotSchema = z
  .object({
    id: formLocalIdSchema,
    label: shortTextSchema,
    color: colorSchema.optional(),
  })
  .strict()
export type FormOptionSnapshot = z.infer<typeof formOptionSnapshotSchema>

const nonNegativeBoundSchema = z.number().int().min(0).max(MAX_FORM_TEXT_INPUT_LENGTH)
const positiveSelectionBoundSchema = z.number().int().min(1).max(MAX_FORM_OPTIONS)
const finiteNumberSchema = z.number().finite()

const formTextInputSchema = z
  .object({
    kind: z.literal('TEXT'),
    multiline: z.boolean(),
    minLength: nonNegativeBoundSchema.optional(),
    maxLength: nonNegativeBoundSchema,
  })
  .strict()
const formNumberInputSchema = z
  .object({
    kind: z.literal('NUMBER'),
    min: finiteNumberSchema.optional(),
    max: finiteNumberSchema.optional(),
    step: finiteNumberSchema.positive().optional(),
  })
  .strict()
const formSingleChoiceInputSchema = z
  .object({
    kind: z.literal('SINGLE_CHOICE'),
    appearance: z.enum(['RADIO', 'LIST', 'DROPDOWN']),
    options: z.array(formOptionSnapshotSchema).min(1).max(MAX_FORM_OPTIONS),
  })
  .strict()
const formMultiChoiceInputSchema = z
  .object({
    kind: z.literal('MULTI_CHOICE'),
    appearance: z.enum(['CHECKLIST', 'MULTI_PICKER']),
    options: z.array(formOptionSnapshotSchema).min(1).max(MAX_FORM_OPTIONS),
    minSelections: z.number().int().min(0).max(MAX_FORM_OPTIONS).optional(),
    maxSelections: positiveSelectionBoundSchema,
  })
  .strict()
const formCheckboxInputSchema = z
  .object({ kind: z.literal('CHECKBOX'), consent: z.boolean() })
  .strict()
const formDateInputSchema = z.object({ kind: z.literal('DATE'), includeTime: z.boolean() }).strict()
const formUrlInputSchema = z.object({ kind: z.literal('URL') }).strict()
const formEmailInputSchema = z.object({ kind: z.literal('EMAIL') }).strict()
const formPhoneInputSchema = z.object({ kind: z.literal('PHONE') }).strict()
const formFileInputSchema = z
  .object({
    kind: z.literal('FILE'),
    allowedMimeTypes: z.array(z.string().min(1).max(255)).max(MAX_FORM_MIME_TYPES),
    maxBytesPerFile: z.number().int().min(1).max(MAX_FORM_FILE_BYTES),
    maxFiles: z.number().int().min(1).max(MAX_FORM_FILES),
  })
  .strict()
const formPersonInputSchema = z
  .object({ kind: z.literal('PERSON'), maxSelections: positiveSelectionBoundSchema })
  .strict()
const formRelationInputSchema = z
  .object({ kind: z.literal('RELATION'), maxSelections: positiveSelectionBoundSchema })
  .strict()
const formPageLinkInputSchema = z.object({ kind: z.literal('PAGE_LINK') }).strict()

const formInputConfigBaseSchema = z.discriminatedUnion('kind', [
  formTextInputSchema,
  formNumberInputSchema,
  formSingleChoiceInputSchema,
  formMultiChoiceInputSchema,
  formCheckboxInputSchema,
  formDateInputSchema,
  formUrlInputSchema,
  formEmailInputSchema,
  formPhoneInputSchema,
  formFileInputSchema,
  formPersonInputSchema,
  formRelationInputSchema,
  formPageLinkInputSchema,
])

export const formInputConfigSchema = formInputConfigBaseSchema.superRefine((input, context) => {
  if (input.kind === 'TEXT' && input.minLength !== undefined && input.minLength > input.maxLength) {
    context.addIssue({
      code: 'custom',
      path: ['minLength'],
      message: 'minLength must not exceed maxLength',
    })
  }

  if (
    input.kind === 'NUMBER' &&
    input.min !== undefined &&
    input.max !== undefined &&
    input.min > input.max
  ) {
    context.addIssue({
      code: 'custom',
      path: ['min'],
      message: 'min must not exceed max',
    })
  }

  if (input.kind === 'MULTI_CHOICE') {
    if (input.maxSelections > input.options.length) {
      context.addIssue({
        code: 'custom',
        path: ['maxSelections'],
        message: 'maxSelections must not exceed the option count',
      })
    }
    if (input.minSelections !== undefined && input.minSelections > input.maxSelections) {
      context.addIssue({
        code: 'custom',
        path: ['minSelections'],
        message: 'minSelections must not exceed maxSelections',
      })
    }
  }
})
export type FormInputConfig = z.infer<typeof formInputConfigSchema>

const conditionBaseShape = { questionId: formLocalIdSchema }
const conditionTextValueSchema = z.string().max(10_000)
const conditionDateValueSchema = z.iso.datetime({ offset: true })

const emptyConditionSchema = z
  .object({ ...conditionBaseShape, kind: z.literal('IS_EMPTY') })
  .strict()
const notEmptyConditionSchema = z
  .object({ ...conditionBaseShape, kind: z.literal('IS_NOT_EMPTY') })
  .strict()
const textEqualsConditionSchema = z
  .object({
    ...conditionBaseShape,
    kind: z.literal('TEXT_EQUALS'),
    value: conditionTextValueSchema,
  })
  .strict()
const textNotEqualsConditionSchema = z
  .object({
    ...conditionBaseShape,
    kind: z.literal('TEXT_NOT_EQUALS'),
    value: conditionTextValueSchema,
  })
  .strict()
const textContainsConditionSchema = z
  .object({
    ...conditionBaseShape,
    kind: z.literal('TEXT_CONTAINS'),
    value: conditionTextValueSchema,
  })
  .strict()
const textNotContainsConditionSchema = z
  .object({
    ...conditionBaseShape,
    kind: z.literal('TEXT_NOT_CONTAINS'),
    value: conditionTextValueSchema,
  })
  .strict()
const numberEqualsConditionSchema = z
  .object({ ...conditionBaseShape, kind: z.literal('NUMBER_EQUALS'), value: finiteNumberSchema })
  .strict()
const numberNotEqualsConditionSchema = z
  .object({
    ...conditionBaseShape,
    kind: z.literal('NUMBER_NOT_EQUALS'),
    value: finiteNumberSchema,
  })
  .strict()
const numberGreaterThanConditionSchema = z
  .object({
    ...conditionBaseShape,
    kind: z.literal('NUMBER_GREATER_THAN'),
    value: finiteNumberSchema,
  })
  .strict()
const numberGreaterThanOrEqualConditionSchema = z
  .object({
    ...conditionBaseShape,
    kind: z.literal('NUMBER_GREATER_THAN_OR_EQUAL'),
    value: finiteNumberSchema,
  })
  .strict()
const numberLessThanConditionSchema = z
  .object({ ...conditionBaseShape, kind: z.literal('NUMBER_LESS_THAN'), value: finiteNumberSchema })
  .strict()
const numberLessThanOrEqualConditionSchema = z
  .object({
    ...conditionBaseShape,
    kind: z.literal('NUMBER_LESS_THAN_OR_EQUAL'),
    value: finiteNumberSchema,
  })
  .strict()
const dateBeforeConditionSchema = z
  .object({
    ...conditionBaseShape,
    kind: z.literal('DATE_BEFORE'),
    value: conditionDateValueSchema,
  })
  .strict()
const dateAfterConditionSchema = z
  .object({ ...conditionBaseShape, kind: z.literal('DATE_AFTER'), value: conditionDateValueSchema })
  .strict()
const dateOnConditionSchema = z
  .object({ ...conditionBaseShape, kind: z.literal('DATE_ON'), value: conditionDateValueSchema })
  .strict()
const checkboxIsConditionSchema = z
  .object({ ...conditionBaseShape, kind: z.literal('CHECKBOX_IS'), value: z.boolean() })
  .strict()
const optionIsConditionSchema = z
  .object({ ...conditionBaseShape, kind: z.literal('OPTION_IS'), optionId: formLocalIdSchema })
  .strict()
const optionIsNotConditionSchema = z
  .object({ ...conditionBaseShape, kind: z.literal('OPTION_IS_NOT'), optionId: formLocalIdSchema })
  .strict()
const optionContainsConditionSchema = z
  .object({
    ...conditionBaseShape,
    kind: z.literal('OPTION_CONTAINS'),
    optionId: formLocalIdSchema,
  })
  .strict()
const optionNotContainsConditionSchema = z
  .object({
    ...conditionBaseShape,
    kind: z.literal('OPTION_NOT_CONTAINS'),
    optionId: formLocalIdSchema,
  })
  .strict()

const formConditionVariantSchemas = [
  emptyConditionSchema,
  notEmptyConditionSchema,
  textEqualsConditionSchema,
  textNotEqualsConditionSchema,
  textContainsConditionSchema,
  textNotContainsConditionSchema,
  numberEqualsConditionSchema,
  numberNotEqualsConditionSchema,
  numberGreaterThanConditionSchema,
  numberGreaterThanOrEqualConditionSchema,
  numberLessThanConditionSchema,
  numberLessThanOrEqualConditionSchema,
  dateBeforeConditionSchema,
  dateAfterConditionSchema,
  dateOnConditionSchema,
  checkboxIsConditionSchema,
  optionIsConditionSchema,
  optionIsNotConditionSchema,
  optionContainsConditionSchema,
  optionNotContainsConditionSchema,
] as const

export const formConditionSchema = z.discriminatedUnion('kind', formConditionVariantSchemas)
export type FormCondition = z.infer<typeof formConditionSchema>

export type FormConditionNode = FormCondition | FormConditionGroup
export type FormConditionGroup =
  { kind: 'ALL'; members: FormConditionNode[] } | { kind: 'ANY'; members: FormConditionNode[] }

const buildGroupVariantSchemas = (memberSchema: z.ZodType<FormConditionNode>) =>
  [
    z
      .object({
        kind: z.literal('ALL'),
        members: z.array(memberSchema).min(1).max(MAX_FORM_CONDITION_MEMBERS),
      })
      .strict(),
    z
      .object({
        kind: z.literal('ANY'),
        members: z.array(memberSchema).min(1).max(MAX_FORM_CONDITION_MEMBERS),
      })
      .strict(),
  ] as const

let boundedConditionMemberSchema: z.ZodType<FormConditionNode> = formConditionSchema
for (let depth = 1; depth < MAX_FORM_CONDITION_DEPTH; depth += 1) {
  const groupVariants = buildGroupVariantSchemas(boundedConditionMemberSchema)
  boundedConditionMemberSchema = z.discriminatedUnion('kind', [
    ...formConditionVariantSchemas,
    ...groupVariants,
  ])
}

export const formConditionGroupSchema: z.ZodType<FormConditionGroup> = z.discriminatedUnion(
  'kind',
  buildGroupVariantSchemas(boundedConditionMemberSchema),
)

export const formQuestionSchema = z
  .object({
    id: formLocalIdSchema,
    sectionId: formLocalIdSchema,
    property: formPropertyRefSchema,
    label: z.string().min(1).max(500),
    description: descriptionSchema.optional(),
    required: z.boolean(),
    syncWithPropertyName: z.boolean(),
    visibleWhen: formConditionGroupSchema.optional(),
    input: formInputConfigSchema,
  })
  .strict()
export type FormQuestion = z.infer<typeof formQuestionSchema>

export const formTransitionSchema = z
  .object({
    id: formLocalIdSchema,
    fromSectionId: formLocalIdSchema,
    priority: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    when: formConditionGroupSchema.nullable(),
    target: formTransitionTargetSchema,
  })
  .strict()
export type FormTransition = z.infer<typeof formTransitionSchema>

const isSafeRedirect = (href: string): boolean => {
  if (/\p{Cc}/u.test(href) || /%(?![0-9a-f]{2})/iu.test(href) || href.trim() !== href) {
    return false
  }

  if (href.startsWith('/')) {
    return !href.startsWith('//') && !href.startsWith('/\\')
  }

  if (!href.startsWith('https://')) return false

  try {
    const url = new URL(href)
    return url.protocol === 'https:' && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

export const formEndingButtonSchema = z
  .object({
    label: shortTextSchema,
    href: z.string().min(1).max(2_048).refine(isSafeRedirect, 'UNSAFE_FORM_REDIRECT'),
  })
  .strict()
export type FormEndingButton = z.infer<typeof formEndingButtonSchema>

export const formEndingSchema = z
  .object({
    id: formLocalIdSchema,
    title: z.string().min(1).max(500),
    body: longTextSchema.optional(),
    button: formEndingButtonSchema.optional(),
  })
  .strict()
export type FormEnding = z.infer<typeof formEndingSchema>

export const formVersionDocumentSchema = z
  .object({
    schemaVersion: z.literal(FORM_SCHEMA_VERSION),
    firstSectionId: formLocalIdSchema,
    presentation: formPresentationSchema,
    sections: z.array(formSectionSchema).min(1).max(MAX_FORM_SECTIONS),
    questions: z.array(formQuestionSchema).min(1).max(MAX_FORM_QUESTIONS),
    transitions: z.array(formTransitionSchema).min(1).max(MAX_FORM_TRANSITIONS),
    endings: z.array(formEndingSchema).min(1).max(MAX_FORM_ENDINGS),
  })
  .strict()
export type FormVersionDocument = z.infer<typeof formVersionDocumentSchema>

export const parseFormVersionDocument = (input: unknown): FormVersionDocument => {
  const document = formVersionDocumentSchema.parse(input)
  const serializedSize = new TextEncoder().encode(JSON.stringify(document)).byteLength

  if (serializedSize > MAX_FORM_DOCUMENT_BYTES) {
    throw new z.ZodError([
      {
        code: 'custom',
        path: [],
        message: 'FORM_DOCUMENT_TOO_LARGE',
        input,
      },
    ])
  }

  return document
}
