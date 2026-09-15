import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export class RecordSyncLogDto {
  @IsIn(['SUCCESS', 'FAILED'])
  status!: 'SUCCESS' | 'FAILED';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  recordCount?: number;

  @IsOptional()
  @IsString()
  @Length(1, 1000)
  note?: string;
}
