import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

// Full-replace, mirroring UpdateHolidayDto. code is intentionally not editable here (same
// convention as UpdateEmployeeGroupDto not allowing the group code to change).
export class UpdateShiftDto {
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsInt()
  @Min(0)
  @Max(1439)
  startMinutes!: number;

  @IsInt()
  @Min(0)
  @Max(1439)
  endMinutes!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  breakMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  graceMinutes?: number;

  @IsOptional()
  @IsBoolean()
  crossesMidnight?: boolean;

  @IsOptional()
  @IsUUID()
  locationId?: string;
}
