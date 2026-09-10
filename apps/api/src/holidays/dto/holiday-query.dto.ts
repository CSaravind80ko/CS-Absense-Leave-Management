import { IsOptional, IsUUID, Matches } from 'class-validator';

export class HolidayQueryDto {
  @IsOptional()
  @IsUUID()
  locationId?: string;

  // 4-digit calendar year, e.g. "2026". Holiday lists are naturally small and viewed a
  // year at a time, so this is a plain filter rather than pagination.
  @IsOptional()
  @Matches(/^\d{4}$/)
  year?: string;
}
