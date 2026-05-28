import { HttpException } from '@nestjs/common'

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
