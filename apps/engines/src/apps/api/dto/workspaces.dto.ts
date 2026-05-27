import { ApiProperty } from '@nestjs/swagger'

// No input DTO — listWorkspaces takes no arguments

export class WorkspaceSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string

  @ApiProperty()
  name!: string

  @ApiProperty({ nullable: true })
  slug!: string | null

  @ApiProperty()
  role!: string
}

export class ListWorkspacesResultDto {
  @ApiProperty({ type: () => WorkspaceSummaryDto, isArray: true })
  workspaces!: WorkspaceSummaryDto[]
}
