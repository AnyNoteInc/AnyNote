import { ApiProperty } from '@nestjs/swagger'
import { IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator'

export class GetWorkspaceStatsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  workspaceId!: string
}

export class WorkspaceLimitDto extends GetWorkspaceStatsDto {
  @ApiProperty({ minimum: 1, maximum: 200, default: 50, required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number
}

export class ListWorkspaceFilesDto extends WorkspaceLimitDto {
  @ApiProperty({ minimum: 0, default: 0, required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number
}

export class ListSkillsDto extends WorkspaceLimitDto {}

export class ListAgentsDto extends WorkspaceLimitDto {}

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
