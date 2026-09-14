import { IsBoolean, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';

// code is intentionally not editable, same convention as employee groups and shifts.
export class UpdateLeaveTypeDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsOptional()
  @IsBoolean()
  paid?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(365)
  defaultAnnualDays?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
