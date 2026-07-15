import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  DatabaseFormAudience,
  DatabaseFormRespondentAccess,
  DatabaseFormState,
  DatabaseViewType,
  NotificationEventType,
  prisma,
} from '../src/index.ts'
import type {
  DatabaseForm,
  DatabaseFormSubmission,
  DatabaseFormUpload,
  DatabaseFormVersion,
} from '../src/index.ts'

const migrationPath = fileURLToPath(
  new URL('../prisma/migrations/20260715170000_database_forms/migration.sql', import.meta.url),
)
const cursorMigrationPath = fileURLToPath(
  new URL(
    '../prisma/migrations/20260716020000_database_form_submission_cursor_index/migration.sql',
    import.meta.url,
  ),
)
const schemaPath = fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url))

const migrationSql = readFileSync(migrationPath, 'utf8')
const normalizedMigrationSql = migrationSql.replace(/\s+/g, ' ').trim()

describe('database forms generated contract', () => {
  it('exports the form enums used across domain and tRPC', () => {
    expect(DatabaseViewType.FORM).toBe('FORM')
    expect(DatabaseFormState.OPEN).toBe('OPEN')
    expect(DatabaseFormAudience.ANYONE_WITH_LINK).toBe('ANYONE_WITH_LINK')
    expect(DatabaseFormRespondentAccess.EDIT).toBe('EDIT')
    expect(NotificationEventType.FORM_SUBMITTED).toBe('FORM_SUBMITTED')
  })

  it('exports the public form model types', () => {
    expectTypeOf<DatabaseForm['routeKey']>().toEqualTypeOf<string>()
    expectTypeOf<DatabaseFormVersion['versionNumber']>().toEqualTypeOf<number>()
    expectTypeOf<DatabaseFormSubmission['rowId']>().toEqualTypeOf<string>()
    expectTypeOf<DatabaseFormUpload['fileId']>().toEqualTypeOf<string>()
  })
})

describe('database forms migration contract', () => {
  it('adds a forward-only composite index aligned to response keyset pagination', () => {
    expect(existsSync(cursorMigrationPath)).toBe(true)
    if (!existsSync(cursorMigrationPath)) return

    const cursorMigrationSql = readFileSync(cursorMigrationPath, 'utf8').replace(/\s+/g, ' ').trim()
    expect(cursorMigrationSql).toContain(
      'CREATE INDEX "database_form_submissions_form_id_submitted_at_id_idx" ON "database_form_submissions"("form_id", "submitted_at" DESC, "id" DESC);',
    )

    const schema = readFileSync(schemaPath, 'utf8').replace(/\s+/g, ' ').trim()
    expect(schema).toContain(
      '@@index([formId, submittedAt(sort: Desc), id(sort: Desc)], map: "database_form_submissions_form_id_submitted_at_id_idx")',
    )
    expect(schema).toContain('@@index([formId, submittedAt(sort: Desc)])')
    expect(normalizedMigrationSql).toContain(
      'CREATE INDEX "database_form_submissions_form_id_submitted_at_idx" ON "database_form_submissions"("form_id", "submitted_at" DESC);',
    )
  })

  it('creates the complete forms graph with its required indexes and foreign keys', () => {
    expect(existsSync(migrationPath)).toBe(true)
    if (!existsSync(migrationPath)) return

    for (const table of [
      'database_forms',
      'database_form_versions',
      'database_form_submissions',
      'database_form_uploads',
    ]) {
      expect(normalizedMigrationSql).toContain(`CREATE TABLE "${table}"`)
    }

    for (const indexClause of [
      'CREATE UNIQUE INDEX "database_forms_view_id_key" ON "database_forms"("view_id");',
      'CREATE UNIQUE INDEX "database_forms_route_key_key" ON "database_forms"("route_key");',
      'CREATE UNIQUE INDEX "database_forms_custom_slug_key" ON "database_forms"("custom_slug");',
      'CREATE UNIQUE INDEX "database_forms_published_version_id_key" ON "database_forms"("published_version_id");',
      'CREATE INDEX "database_forms_source_id_idx" ON "database_forms"("source_id");',
      'CREATE INDEX "database_forms_state_opens_at_closes_at_idx" ON "database_forms"("state", "opens_at", "closes_at");',
      'CREATE UNIQUE INDEX "database_form_versions_form_id_version_number_key" ON "database_form_versions"("form_id", "version_number");',
      'CREATE INDEX "database_form_versions_form_id_published_at_idx" ON "database_form_versions"("form_id", "published_at" DESC);',
      'CREATE UNIQUE INDEX "database_form_submissions_row_id_key" ON "database_form_submissions"("row_id");',
      'CREATE UNIQUE INDEX "database_form_submissions_form_id_idempotency_key_key" ON "database_form_submissions"("form_id", "idempotency_key");',
      'CREATE INDEX "database_form_submissions_form_id_submitted_at_idx" ON "database_form_submissions"("form_id", "submitted_at" DESC);',
      'CREATE INDEX "database_form_submissions_respondent_user_id_submitted_at_idx" ON "database_form_submissions"("respondent_user_id", "submitted_at" DESC);',
      'CREATE UNIQUE INDEX "database_form_uploads_file_id_key" ON "database_form_uploads"("file_id");',
      'CREATE INDEX "database_form_uploads_form_id_version_id_question_id_idx" ON "database_form_uploads"("form_id", "version_id", "question_id");',
      'CREATE INDEX "database_form_uploads_form_id_expires_at_idx" ON "database_form_uploads"("form_id", "expires_at");',
      'CREATE INDEX "database_form_uploads_expires_at_consumed_at_idx" ON "database_form_uploads"("expires_at", "consumed_at");',
    ]) {
      expect(normalizedMigrationSql).toContain(indexClause)
    }

    for (const foreignKeyClause of [
      'ALTER TABLE "database_forms" ADD CONSTRAINT "database_forms_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "database_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
      'ALTER TABLE "database_forms" ADD CONSTRAINT "database_forms_view_id_fkey" FOREIGN KEY ("view_id") REFERENCES "database_views"("id") ON DELETE SET NULL ON UPDATE CASCADE;',
      'ALTER TABLE "database_forms" ADD CONSTRAINT "database_forms_published_version_id_fkey" FOREIGN KEY ("published_version_id") REFERENCES "database_form_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;',
      'ALTER TABLE "database_forms" ADD CONSTRAINT "database_forms_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;',
      'ALTER TABLE "database_form_versions" ADD CONSTRAINT "database_form_versions_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "database_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
      'ALTER TABLE "database_form_versions" ADD CONSTRAINT "database_form_versions_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;',
      'ALTER TABLE "database_form_submissions" ADD CONSTRAINT "database_form_submissions_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "database_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
      'ALTER TABLE "database_form_submissions" ADD CONSTRAINT "database_form_submissions_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "database_form_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
      'ALTER TABLE "database_form_submissions" ADD CONSTRAINT "database_form_submissions_row_id_fkey" FOREIGN KEY ("row_id") REFERENCES "database_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
      'ALTER TABLE "database_form_submissions" ADD CONSTRAINT "database_form_submissions_respondent_user_id_fkey" FOREIGN KEY ("respondent_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;',
      'ALTER TABLE "database_form_uploads" ADD CONSTRAINT "database_form_uploads_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "database_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
      'ALTER TABLE "database_form_uploads" ADD CONSTRAINT "database_form_uploads_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "database_form_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
      'ALTER TABLE "database_form_uploads" ADD CONSTRAINT "database_form_uploads_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
    ]) {
      expect(normalizedMigrationSql).toContain(foreignKeyClause)
    }
  })

  it('converts only non-empty scalar FILE values into arrays and is idempotent', async () => {
    expect(existsSync(migrationPath)).toBe(true)
    if (!existsSync(migrationPath)) return

    const updateStatement = migrationSql.match(/UPDATE "database_cell_values" AS c[\s\S]*?;/)?.[0]
    expect(updateStatement).toBeDefined()
    if (!updateStatement) return

    await prisma.$transaction(async (tx) => {
      try {
        await tx.$executeRawUnsafe(`
          CREATE TEMP TABLE "database_properties" (
            "id" TEXT PRIMARY KEY,
            "type" TEXT NOT NULL
          ) ON COMMIT DROP
        `)
        await tx.$executeRawUnsafe(`
          CREATE TEMP TABLE "database_cell_values" (
            "id" TEXT PRIMARY KEY,
            "property_id" TEXT NOT NULL,
            "value" JSONB
          ) ON COMMIT DROP
        `)
        await tx.$executeRawUnsafe(`
          INSERT INTO "database_properties" ("id", "type")
          VALUES ('file-property', 'FILE'), ('text-property', 'TEXT')
        `)
        await tx.$executeRawUnsafe(`
          INSERT INTO "database_cell_values" ("id", "property_id", "value") VALUES
            ('file-array', 'file-property', '["file-2"]'::jsonb),
            ('file-empty-string', 'file-property', '""'::jsonb),
            ('file-json-null', 'file-property', 'null'::jsonb),
            ('file-sql-null', 'file-property', NULL),
            ('file-string', 'file-property', '"file-1"'::jsonb),
            ('non-file-string', 'text-property', '"file-3"'::jsonb)
        `)

        await tx.$executeRawUnsafe(updateStatement)
        const expectedValues = [
          { id: 'file-array', value: '["file-2"]' },
          { id: 'file-empty-string', value: '""' },
          { id: 'file-json-null', value: 'null' },
          { id: 'file-sql-null', value: null },
          { id: 'file-string', value: '["file-1"]' },
          { id: 'non-file-string', value: '"file-3"' },
        ]

        const valuesAfterFirstRun = await tx.$queryRawUnsafe<
          Array<{ id: string; value: string | null }>
        >('SELECT "id", "value"::text AS "value" FROM "database_cell_values" ORDER BY "id"')
        expect(valuesAfterFirstRun).toEqual(expectedValues)

        await tx.$executeRawUnsafe(updateStatement)
        const valuesAfterSecondRun = await tx.$queryRawUnsafe<
          Array<{ id: string; value: string | null }>
        >('SELECT "id", "value"::text AS "value" FROM "database_cell_values" ORDER BY "id"')
        expect(valuesAfterSecondRun).toEqual(expectedValues)
      } finally {
        await tx.$executeRawUnsafe('DROP TABLE IF EXISTS "database_cell_values"')
        await tx.$executeRawUnsafe('DROP TABLE IF EXISTS "database_properties"')
      }
    })
  })
})
