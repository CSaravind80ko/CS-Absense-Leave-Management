import { ApprovalActionType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export class ApprovalActionDto {
  @IsEnum(ApprovalActionType)
  action!: ApprovalActionType;

  @IsOptional()
  @IsString()
  @Length(1, 1000)
  comment?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}
