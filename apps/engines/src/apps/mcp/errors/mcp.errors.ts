import { HttpException } from '@nestjs/common'

export type DatabaseErrorCode =
  | 'PAGE_IS_NOT_DATABASE'
  | 'DATABASE_FIELD_NOT_FOUND'
  | 'DATABASE_FIELD_AMBIGUOUS'
  | 'DATABASE_FILTER_OPERATOR_INVALID'
  | 'DATABASE_FILTER_VALUE_INVALID'
  | 'DATABASE_DATE_INVALID'
  | 'DATABASE_SORT_UNSUPPORTED'
  | 'DATABASE_CURSOR_INVALID'

type SafeDatabaseField = {
  id: string
  name: string
  type: string
}

abstract class DatabaseMcpError extends HttpException {
  abstract readonly code: DatabaseErrorCode
}

export class PageIsNotDatabaseError extends DatabaseMcpError {
  readonly code = 'PAGE_IS_NOT_DATABASE' as const

  constructor() {
    super(
      {
        code: 'PAGE_IS_NOT_DATABASE',
        message: 'PAGE_IS_NOT_DATABASE: the requested page is not a database',
      },
      422,
    )
  }
}

export class DatabaseFieldNotFoundError extends DatabaseMcpError {
  readonly code = 'DATABASE_FIELD_NOT_FOUND' as const

  constructor() {
    super(
      {
        code: 'DATABASE_FIELD_NOT_FOUND',
        message: 'DATABASE_FIELD_NOT_FOUND: no matching database field',
      },
      422,
    )
  }
}

export class DatabaseFieldAmbiguousError extends DatabaseMcpError {
  readonly code = 'DATABASE_FIELD_AMBIGUOUS' as const

  constructor(readonly fields: SafeDatabaseField[]) {
    super(
      {
        code: 'DATABASE_FIELD_AMBIGUOUS',
        message: 'DATABASE_FIELD_AMBIGUOUS: more than one database field matches',
        fields,
      },
      422,
    )
  }
}

export class DatabaseFilterOperatorInvalidError extends DatabaseMcpError {
  readonly code = 'DATABASE_FILTER_OPERATOR_INVALID' as const

  constructor(readonly allowedOperators: string[]) {
    super(
      {
        code: 'DATABASE_FILTER_OPERATOR_INVALID',
        message: 'DATABASE_FILTER_OPERATOR_INVALID: operator is not supported for this field',
        allowedOperators,
      },
      422,
    )
  }
}

export class DatabaseFilterValueInvalidError extends DatabaseMcpError {
  readonly code = 'DATABASE_FILTER_VALUE_INVALID' as const

  constructor(readonly valueSchema: Record<string, unknown>) {
    super(
      {
        code: 'DATABASE_FILTER_VALUE_INVALID',
        message: 'DATABASE_FILTER_VALUE_INVALID: filter value does not match the field schema',
        valueSchema,
      },
      422,
    )
  }
}

export class DatabaseDateInvalidError extends DatabaseMcpError {
  readonly code = 'DATABASE_DATE_INVALID' as const

  constructor() {
    super(
      {
        code: 'DATABASE_DATE_INVALID',
        message: 'DATABASE_DATE_INVALID: expected ISO 8601 date-time with an explicit timezone',
      },
      422,
    )
  }
}

export class DatabaseSortUnsupportedError extends DatabaseMcpError {
  readonly code = 'DATABASE_SORT_UNSUPPORTED' as const
  readonly supportedPropertyIds = ['__title__'] as const

  constructor() {
    super(
      {
        code: 'DATABASE_SORT_UNSUPPORTED',
        message: 'DATABASE_SORT_UNSUPPORTED: only the TITLE field can be sorted',
        supportedPropertyIds: ['__title__'],
      },
      422,
    )
  }
}

export class DatabaseCursorInvalidError extends DatabaseMcpError {
  readonly code = 'DATABASE_CURSOR_INVALID' as const

  constructor() {
    super(
      {
        code: 'DATABASE_CURSOR_INVALID',
        message: 'DATABASE_CURSOR_INVALID: cursor must identify a live row in this database',
      },
      422,
    )
  }
}

export class WorkspaceAccessDeniedError extends HttpException {
  constructor(workspaceId: string, userId: string) {
    super(
      {
        code: 'WORKSPACE_ACCESS_DENIED',
        message: `Access denied: user ${userId} is not a member of workspace ${workspaceId}`,
      },
      403,
    )
  }
}

export class PageNotFoundError extends HttpException {
  constructor(pageId: string) {
    super({ code: 'PAGE_NOT_FOUND', message: `PAGE_NOT_FOUND: page ${pageId} not found` }, 404)
  }
}

export class FileNotFoundError extends HttpException {
  constructor(fileId: string) {
    super({ code: 'FILE_NOT_FOUND', message: `FILE_NOT_FOUND: file ${fileId} not found` }, 404)
  }
}

export class FileTooLargeError extends HttpException {
  constructor(size: number, limit: number) {
    super(
      {
        code: 'FILE_TOO_LARGE',
        message: `FILE_TOO_LARGE: file size ${size} exceeds inline limit ${limit}. Upload via apps/web and use attachFileToPage instead.`,
      },
      413,
    )
  }
}

export class UnsupportedMimeTypeError extends HttpException {
  constructor(mimeType: string) {
    super(
      {
        code: 'UNSUPPORTED_MIME_TYPE',
        message: `UNSUPPORTED_MIME_TYPE: MIME type ${mimeType} not supported`,
      },
      415,
    )
  }
}

export class ReminderNotFoundError extends HttpException {
  constructor(reminderId: string) {
    super(
      {
        code: 'REMINDER_NOT_FOUND',
        message: `REMINDER_NOT_FOUND: reminder ${reminderId} not found or not owned by caller`,
      },
      404,
    )
  }
}

export class DiagramValidationError extends HttpException {
  constructor(kind: string, messages: string[]) {
    super(
      {
        code: 'DIAGRAM_VALIDATION_FAILED',
        message: `DIAGRAM_VALIDATION_FAILED (${kind}): ${messages.join('; ')}`,
        errors: messages,
      },
      422,
    )
  }
}

export class PdfExportUnsupportedPageTypeError extends HttpException {
  constructor(pageType: string) {
    super(
      {
        code: 'PDF_EXPORT_UNSUPPORTED_PAGE_TYPE',
        message: `PDF_EXPORT_UNSUPPORTED_PAGE_TYPE: only TEXT pages can be exported to PDF, got ${pageType}`,
      },
      422,
    )
  }
}

export class PdfRenderFailedError extends HttpException {
  constructor(reason: string) {
    super(
      { code: 'PDF_RENDER_FAILED', message: `PDF_RENDER_FAILED: ${reason}. Попробуйте позже.` },
      502,
    )
  }
}

export class WorkspaceStorageLimitError extends HttpException {
  constructor(maxBytes: bigint) {
    super(
      {
        code: 'WORKSPACE_STORAGE_LIMIT',
        message: `WORKSPACE_STORAGE_LIMIT: workspace storage quota (${maxBytes} bytes) would be exceeded`,
      },
      413,
    )
  }
}
