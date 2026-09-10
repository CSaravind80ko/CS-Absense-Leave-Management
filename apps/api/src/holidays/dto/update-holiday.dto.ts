import { IsDateString, IsOptional, IsString, IsUUID, Length } from 'class-validator';

// Full-replace, mirroring how the UI form always submits every field. locationId omitted
// means tenant-wide, the same convention as CreateHolidayDto.
export class UpdateHolidayDto {
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsDateString({ strict: true })
  date!: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;
}
