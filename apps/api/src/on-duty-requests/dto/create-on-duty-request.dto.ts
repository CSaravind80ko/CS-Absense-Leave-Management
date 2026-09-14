import { OnDutyCategory } from '@prisma/client';
import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, Length } from 'class-validator';

export class CreateOnDutyRequestDto {
  @IsEnum(OnDutyCategory)
  category!: OnDutyCategory;

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
  @Length(0, 200)
  location?: string;

  @IsString()
  @Length(1, 1000)
  reason!: string;
}
