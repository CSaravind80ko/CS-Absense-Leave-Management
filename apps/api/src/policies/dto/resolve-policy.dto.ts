import { IsDateString, IsUUID } from 'class-validator';

export class ResolvePolicyDto {
  @IsUUID()
  employeeId!: string;

  @IsDateString({ strict: true })
  date!: string;
}
