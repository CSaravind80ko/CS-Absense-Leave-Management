import { IsDateString, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateHolidayDto {
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsDateString({ strict: true })
  date!: string;

  // Omitted means tenant-wide (applies at every location).
  @IsOptional()
  @IsUUID()
  locationId?: string;
}
