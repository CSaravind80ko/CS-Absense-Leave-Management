import { ApprovalActionType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';

export class ApprovalActionDto {
  @IsEnum(ApprovalActionType)
  action!: ApprovalActionType;

  @IsOptional()
  @IsString()
  @Length(1, 1000)
  comment?: string;
}
