import { AttendanceStatus, PeriodStatus } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { PageQueryDto } from '../../common/dto/page-query.dto';

export class PeriodQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(PeriodStatus)
  status?: PeriodStatus;

  @IsOptional()
  @IsIn(['startsOn', 'endsOn', 'name', 'status', 'updatedAt'])
  sortBy: 'startsOn' | 'endsOn' | 'name' | 'status' | 'updatedAt' = 'startsOn';
}

export class AttendanceRegisterQueryDto extends PageQueryDto {
  @IsUUID()
  periodId!: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsIn(['workDate', 'status', 'workedMinutes', 'employeeNumber', 'employeeName'])
  sortBy:
    | 'workDate'
    | 'status'
    | 'workedMinutes'
    | 'employeeNumber'
    | 'employeeName' = 'workDate';
}

export class DashboardQueryDto {
  @IsUUID()
  periodId!: string;
}

export class ImportQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  periodId?: string;

  @IsOptional()
  @IsIn(['createdAt', 'status', 'source'])
  sortBy: 'createdAt' | 'status' | 'source' = 'createdAt';
}

export class WorkerImportResultDto {
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  acceptedRows!: number;

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  rejectedRows!: number;
}
