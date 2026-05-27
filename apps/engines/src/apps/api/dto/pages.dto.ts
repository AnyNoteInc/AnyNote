import { ApiProperty } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator'

export class CreatePageDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  workspaceId!: string

  @ApiProperty({ format: 'uuid', nullable: true, required: false })
  @IsOptional()
  @IsUUID()
  parentId?: string | null

  @ApiProperty({ minLength: 1, maxLength: 255 })
  @IsString()
  @Length(1, 255)
  title!: string

  @ApiProperty({ enum: ['TEXT', 'SKILL', 'AGENT'], default: 'TEXT', required: false })
  @IsOptional()
  @IsIn(['TEXT', 'SKILL', 'AGENT'])
  ownership?: 'TEXT' | 'SKILL' | 'AGENT'

  @ApiProperty({ maxLength: 50000, required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  markdown?: string
}

export class UpdatePageDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  workspaceId!: string

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  pageId!: string

  @ApiProperty({ maxLength: 255, required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string

  @ApiProperty({ nullable: true, required: false })
  @IsOptional()
  @IsString()
  icon?: string | null

  @ApiProperty({ type: 'object', additionalProperties: { type: 'object' } })
  @IsOptional()
  content?: unknown
}

export class MovePageDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  workspaceId!: string

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  pageId!: string

  @ApiProperty({ format: 'uuid', nullable: true, required: false })
  @IsOptional()
  @IsUUID()
  newParentId?: string | null

  @ApiProperty({ format: 'uuid', nullable: true, required: false })
  @IsOptional()
  @IsUUID()
  prevPageId?: string | null
}

export class PageIdDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  workspaceId!: string

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  pageId!: string
}

export class GetPageMarkdownDto extends PageIdDto {}

export class GetPageStatsDto extends PageIdDto {}
