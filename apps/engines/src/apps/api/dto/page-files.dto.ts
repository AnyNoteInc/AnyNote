import { ApiProperty } from '@nestjs/swagger'
import { IsString, IsUUID, Length } from 'class-validator'

export class UploadFileToPageDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  workspaceId!: string

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  pageId!: string

  @ApiProperty({ minLength: 1, maxLength: 512 })
  @IsString()
  @Length(1, 512)
  fileName!: string

  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  @Length(1, 128)
  mimeType!: string

  @ApiProperty({ minLength: 1, description: 'Base64-encoded file content (max 1 MB)' })
  @IsString()
  @Length(1)
  contentBase64!: string
}

export class UploadImageToPageDto extends UploadFileToPageDto {}

export class AttachFileToPageDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  workspaceId!: string

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  pageId!: string

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  fileId!: string
}

export class AttachImageToPageDto extends AttachFileToPageDto {}

export class ListPageFilesDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  workspaceId!: string

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  pageId!: string
}

export class PageFileItemDto {
  @ApiProperty()
  id!: string

  @ApiProperty()
  name!: string

  @ApiProperty()
  mimeType!: string

  @ApiProperty()
  size!: number

  @ApiProperty()
  createdAt!: Date
}

export class ListPageFilesResultDto {
  @ApiProperty({ type: () => PageFileItemDto, isArray: true })
  files!: PageFileItemDto[]
}
