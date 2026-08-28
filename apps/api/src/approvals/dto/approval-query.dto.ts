import { ApprovalStatus, ApprovalType } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PageQueryDto } from '../../common/dto/page-query.dto';

export class ApprovalQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  periodId?: string;

  @IsOptional()
  @IsEnum(ApprovalStatus)
  status?: ApprovalStatus;

  @IsOptional()
  @IsEnum(ApprovalType)
  type?: ApprovalType;

  @IsOptional()
  @IsIn(['inbox', 'requested', 'all'])
  scope: 'inbox' | 'requested' | 'all' = 'inbox';

  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'status', 'type'])
  sortBy: 'createdAt' | 'updatedAt' | 'status' | 'type' = 'createdAt';
}
