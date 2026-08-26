import { IsString, IsUUID, Length } from 'class-validator';

export class CreatePayrollExportDto {
  @IsUUID()
  periodId!: string;

  @IsUUID()
  approvalRequestId!: string;

  @IsString()
  @Length(1, 30)
  format!: string;
}
