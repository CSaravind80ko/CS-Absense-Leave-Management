import { IsBoolean, IsDateString, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateLeaveRequestDto {
  @IsUUID()
  leaveTypeId!: string;

  @IsDateString({ strict: true })
  startDate!: string;

  @IsDateString({ strict: true })
  endDate!: string;

  // Only meaningful when startDate === endDate; validated in the service.
  @IsOptional()
  @IsBoolean()
  halfDay?: boolean;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  reason?: string;
}
