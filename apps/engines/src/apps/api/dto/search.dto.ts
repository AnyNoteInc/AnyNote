import { ApiProperty } from '@nestjs/swagger'
import { IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator'

export class SearchPagesDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  workspaceId!: string

  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  @Length(1, 500)
  query!: string

  @ApiProperty({ minimum: 1, maximum: 20, default: 10, required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  k?: number
}

export class SearchHitDto {
  @ApiProperty()
  pageId!: string

  @ApiProperty()
  score!: number

  @ApiProperty({ required: false })
  snippet?: string
}

export class SearchPagesResultDto {
  @ApiProperty({ type: () => SearchHitDto, isArray: true })
  results!: SearchHitDto[]
}
