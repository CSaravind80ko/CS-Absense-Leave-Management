import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { PeriodStatus } from '@prisma/client';

export class UpdatePeriodStatusDto {
  @IsEnum(PeriodStatus)
  status!: PeriodStatus;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsString()
  @Length(3, 1000)
  reason?: string;
}
