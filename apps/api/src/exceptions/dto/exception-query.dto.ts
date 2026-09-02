import {
  ApplicationRole,
  ExceptionSeverity,
  ExceptionStatus,
  ExceptionType,
} from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PageQueryDto } from '../../common/dto/page-query.dto';

export class ExceptionQueryDto extends PageQueryDto {
  @IsUUID()
  periodId!: string;

  @IsOptional()
  @IsEnum(ExceptionStatus)
  status?: ExceptionStatus;

  @IsOptional()
  @IsEnum(ExceptionSeverity)
  severity?: ExceptionSeverity;

  @IsOptional()
  @IsEnum(ExceptionType)
  type?: ExceptionType;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  assignedToSubject?: string;

  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'severity', 'status'])
  sortBy: 'createdAt' | 'updatedAt' | 'severity' | 'status' = 'createdAt';
}

export class AssignExceptionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @ValidateIf((value: AssignExceptionDto) => !value.assignedToRole)
  @IsString()
  assignedToSubject?: string;

  @ValidateIf((value: AssignExceptionDto) => !value.assignedToSubject)
  @IsEnum(ApplicationRole)
  assignedToRole?: ApplicationRole;
}
