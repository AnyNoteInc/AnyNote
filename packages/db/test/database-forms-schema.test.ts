import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DatabaseFormAudience,
  DatabaseFormRespondentAccess,
  DatabaseFormState,
  DatabaseViewType,
  NotificationEventType,
} from '../src/index.ts'

const migrationPath = fileURLToPath(
  new URL('../prisma/migrations/20260715170000_database_forms/migration.sql', import.meta.url),
)

describe('database forms generated contract', () => {
  it('exports the form enums used across domain and tRPC', () => {
    expect(DatabaseViewType.FORM).toBe('FORM')
    expect(DatabaseFormState.OPEN).toBe('OPEN')
    expect(DatabaseFormAudience.ANYONE_WITH_LINK).toBe('ANYONE_WITH_LINK')
    expect(DatabaseFormRespondentAccess.EDIT).toBe('EDIT')
    expect(NotificationEventType.FORM_SUBMITTED).toBe('FORM_SUBMITTED')
  })
})

describe('database forms migration contract', () => {
  it('creates the complete forms graph with its required indexes and foreign keys', () => {
    expect(existsSync(migrationPath)).toBe(true)
    if (!existsSync(migrationPath)) return

    const sql = readFileSync(migrationPath, 'utf8')

    for (const table of [
      'database_forms',
      'database_form_versions',
      'database_form_submissions',
      'database_form_uploads',
    ]) {
      expect(sql).toContain(`CREATE TABLE "${table}"`)
    }

    for (const index of [
      'database_forms_view_id_key',
      'database_forms_route_key_key',
      'database_forms_custom_slug_key',
      'database_forms_published_version_id_key',
      'database_forms_source_id_idx',
      'database_forms_state_opens_at_closes_at_idx',
      'database_form_versions_form_id_version_number_key',
      'database_form_versions_form_id_published_at_idx',
      'database_form_submissions_row_id_key',
      'database_form_submissions_form_id_idempotency_key_key',
      'database_form_submissions_form_id_submitted_at_idx',
      'database_form_submissions_respondent_user_id_submitted_at_idx',
      'database_form_uploads_file_id_key',
      'database_form_uploads_form_id_version_id_question_id_idx',
      'database_form_uploads_form_id_expires_at_idx',
      'database_form_uploads_expires_at_consumed_at_idx',
    ]) {
      expect(sql).toContain(`"${index}"`)
    }

    for (const foreignKey of [
      'database_forms_source_id_fkey',
      'database_forms_view_id_fkey',
      'database_forms_published_version_id_fkey',
      'database_forms_created_by_id_fkey',
      'database_form_versions_form_id_fkey',
      'database_form_versions_published_by_id_fkey',
      'database_form_submissions_form_id_fkey',
      'database_form_submissions_version_id_fkey',
      'database_form_submissions_row_id_fkey',
      'database_form_submissions_respondent_user_id_fkey',
      'database_form_uploads_form_id_fkey',
      'database_form_uploads_version_id_fkey',
      'database_form_uploads_file_id_fkey',
    ]) {
      expect(sql).toContain(`CONSTRAINT "${foreignKey}"`)
    }
  })

  it('converts only non-empty scalar FILE values into arrays', () => {
    expect(existsSync(migrationPath)).toBe(true)
    if (!existsSync(migrationPath)) return

    const sql = readFileSync(migrationPath, 'utf8')

    expect(sql).toContain('SET "value" = jsonb_build_array(c."value")')
    expect(sql).toContain(`AND p."type" = 'FILE'`)
    expect(sql).toContain(`AND jsonb_typeof(c."value") = 'string'`)
    expect(sql).toContain(`AND c."value" <> '\"\"'::jsonb`)
  })
})
