import { ApiProperty } from '@nestjs/swagger'
import { IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator'

// GetWorkspaceStats: workspaceId only
export class GetWorkspaceStatsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  workspaceId!: string
}

// ListWorkspaceFiles (PaginationInput): workspaceId, limit (1-200 default 50), offset (>=0 default 0)
export class ListWorkspaceFilesDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  workspaceId!: string

  @ApiProperty({ minimum: 1, maximum: 200, default: 50, required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number

  @ApiProperty({ minimum: 0, default: 0, required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number
}

// ListSkills (LimitInput): workspaceId, limit (1-200 default 50)
export class ListSkillsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  workspaceId!: string

  @ApiProperty({ minimum: 1, maximum: 200, default: 50, required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number
}

// ListAgents (LimitInput): workspaceId, limit (1-200 default 50)
export class ListAgentsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  workspaceId!: string

  @ApiProperty({ minimum: 1, maximum: 200, default: 50, required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number
}

// CreatePageFromFile: workspaceId, parentId? (nullable uuid), fileId, title? (1-255)
export class CreatePageFromFileDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  workspaceId!: string

  @ApiProperty({ format: 'uuid', nullable: true, required: false })
  @IsOptional()
  @IsUUID()
  parentId?: string | null

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  fileId!: string

  @ApiProperty({ minLength: 1, maxLength: 255, required: false })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  title?: string
}
