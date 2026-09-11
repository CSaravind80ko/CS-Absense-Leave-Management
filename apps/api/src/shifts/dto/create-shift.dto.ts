import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

export class CreateShiftDto {
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsString()
  @Length(1, 50)
  code!: string;

  // Minutes since local midnight (0-1439). The worker treats endMinutes < startMinutes as an
  // overnight shift via modulo arithmetic, so no ordering is enforced here.
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
