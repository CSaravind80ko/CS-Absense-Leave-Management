import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { PageQueryDto } from '../../common/dto/page-query.dto';

export class PayrollRegisterQueryDto extends PageQueryDto {
  @IsUUID()
  periodId!: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['employeeNumber', 'employeeName'])
  sortBy: 'employeeNumber' | 'employeeName' = 'employeeNumber';
}

export class PayrollExportQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  periodId?: string;

  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'status'])
  sortBy: 'createdAt' | 'updatedAt' | 'status' = 'createdAt';
}
