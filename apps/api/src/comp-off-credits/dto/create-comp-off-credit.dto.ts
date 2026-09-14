import { IsDateString, IsOptional, IsString, Length } from 'class-validator';

export class CreateCompOffCreditDto {
  @IsDateString({ strict: true })
  workedDate!: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  reason?: string;
}
