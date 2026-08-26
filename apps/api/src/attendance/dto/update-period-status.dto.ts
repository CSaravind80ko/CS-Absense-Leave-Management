import { IsEnum } from 'class-validator';
import { PeriodStatus } from '@prisma/client';

export class UpdatePeriodStatusDto {
  @IsEnum(PeriodStatus)
  status!: PeriodStatus;
}
