import { IsBoolean, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateLeaveTypeDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsString()
  @Length(1, 50)
  code!: string;

  @IsOptional()
  @IsBoolean()
  paid?: boolean;

  // Omitted means no standard allocation (e.g. unpaid leave); balances are then set
  // individually and requests against this type skip the balance check entirely.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(365)
  defaultAnnualDays?: number;
}
