import { ApprovalType } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export class CreateApprovalDto {
  @IsEnum(ApprovalType)
  type!: ApprovalType;

  @IsOptional()
  @IsUUID()
  periodId?: string;

  @IsOptional()
  @IsUUID()
  exceptionId?: string;
}
