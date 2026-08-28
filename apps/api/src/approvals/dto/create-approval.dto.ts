import { ApplicationRole, ApprovalType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateApprovalDto {
  @IsEnum(ApprovalType)
  type!: ApprovalType;

  @IsOptional()
  @IsUUID()
  periodId?: string;

  @IsOptional()
  @IsUUID()
  exceptionId?: string;

  @IsOptional()
  @IsString()
  assigneeSubject?: string;

  @IsOptional()
  @IsEnum(ApplicationRole)
  assigneeRole?: ApplicationRole;
}
