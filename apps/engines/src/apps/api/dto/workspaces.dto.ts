import { ApiProperty } from '@nestjs/swagger'

// No input DTO — the REST listWorkspaces endpoint takes no arguments
// (isCurrent is therefore always false over REST; it is set for MCP callers
// where the active workspaceId is injected).

export class WorkspaceSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string

  @ApiProperty()
  name!: string

  @ApiProperty({ nullable: true })
  slug!: string | null

  @ApiProperty()
  role!: string

  @ApiProperty()
  isCurrent!: boolean

  @ApiProperty()
  isDefault!: boolean
}

export class ListWorkspacesResultDto {
  @ApiProperty({ type: () => WorkspaceSummaryDto, isArray: true })
  workspaces!: WorkspaceSummaryDto[]
}
