import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class CreatePayrollExportDto {
  @IsUUID()
  periodId!: string;

  @IsOptional()
  @IsUUID()
  approvalRequestId?: string;

  @IsIn(['CSV', 'XLSX'])
  format!: 'CSV' | 'XLSX';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  periodVersion!: number;
}
