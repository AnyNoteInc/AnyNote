import { z } from 'zod'

import type { DatabaseRowView } from '../dto/database.dto.ts'

import { formVersionDocumentSchema, MAX_FORM_QUESTIONS } from './form-document.ts'

const uuidSchema = z.string().uuid()

export const formLocatorSchema = z.string().trim().min(3).max(64)

export const createFormInput = z.object({
  pageId: uuidSchema,
  title: z.string().trim().min(1).max(200),
})
export type CreateFormInput = z.infer<typeof createFormInput>

export const formIdInput = z.object({ pageId: uuidSchema, formId: uuidSchema })
export type FormIdInput = z.infer<typeof formIdInput>

export const listFormsInput = z.object({ pageId: uuidSchema })
export type ListFormsInput = z.infer<typeof listFormsInput>

export const updateFormDraftInput = formIdInput.extend({
  expectedRevision: z.number().int().positive(),
  schema: formVersionDocumentSchema,
  propertyNameIntents: z
    .record(uuidSchema, z.string().min(1).max(200))
    .superRefine((intents, context) => {
      if (Object.keys(intents).length > MAX_FORM_QUESTIONS) {
        context.addIssue({ code: 'custom', message: 'TOO_MANY_PROPERTY_NAME_INTENTS' })
      }
    })
    .optional(),
})
export type UpdateFormDraftInput = z.infer<typeof updateFormDraftInput>

export const publishFormInput = formIdInput
export type PublishFormInput = z.infer<typeof publishFormInput>

export const databaseFormAudienceSchema = z.enum([
  'ANYONE_WITH_LINK',
  'SIGNED_IN_WITH_LINK',
  'WORKSPACE_MEMBERS_WITH_LINK',
])
export const databaseFormRespondentAccessSchema = z.enum(['NONE', 'VIEW', 'EDIT'])

const nullableDateSchema = z.preprocess((value) => {
  if (value === null || value instanceof Date) return value
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? value : parsed
  }
  return value
}, z.date().nullable())

export const updateFormSettingsInput = formIdInput.extend({
  audience: databaseFormAudienceSchema,
  respondentAccess: databaseFormRespondentAccessSchema,
  opensAt: nullableDateSchema,
  closesAt: nullableDateSchema,
  responseLimit: z.number().int().positive().nullable(),
  notifyOwners: z.boolean(),
})
export type UpdateFormSettingsInput = z.infer<typeof updateFormSettingsInput>

export const customSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)

export const setFormSlugInput = formIdInput.extend({ slug: z.string().nullable() })
export type SetFormSlugInput = z.infer<typeof setFormSlugInput>

export const duplicateFormViewInput = z.object({ pageId: uuidSchema, viewId: uuidSchema })
export type DuplicateFormViewInput = z.infer<typeof duplicateFormViewInput>

export const renameFormViewInput = duplicateFormViewInput.extend({
  title: z.string().trim().min(1).max(200),
})
export type RenameFormViewInput = z.infer<typeof renameFormViewInput>

export const listFormResponsesInput = formIdInput.extend({
  cursor: z.object({ submittedAt: z.coerce.date(), id: uuidSchema }).optional(),
  limit: z.number().int().min(1).max(100).default(50),
})
export type ListFormResponsesInput = z.infer<typeof listFormResponsesInput>

export interface FormResponseListItem {
  submissionId: string
  submittedAt: Date
  endingId: string
  row: DatabaseRowView
}

export interface ListFormResponsesResult {
  items: FormResponseListItem[]
  nextCursor: { submittedAt: Date; id: string } | null
}
