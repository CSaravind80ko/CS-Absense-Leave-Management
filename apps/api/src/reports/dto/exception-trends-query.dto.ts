import { IsString, Length } from 'class-validator';

export class ExceptionTrendsQueryDto {
  // Comma-separated processing period ids, oldest to newest; the service validates each
  // resolves to a period owned by the caller's tenant.
  @IsString()
  @Length(1, 2000)
  periodIds!: string;
}
