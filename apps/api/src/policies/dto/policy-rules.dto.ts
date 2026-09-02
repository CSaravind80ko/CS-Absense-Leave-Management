import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min, ValidateNested } from 'class-validator';

export class LateArrivalRuleDto {
  @IsInt()
  @Min(0)
  @Max(240)
  graceMinutes!: number;
}

export class EarlyDepartureRuleDto {
  @IsInt()
  @Min(0)
  @Max(240)
  graceMinutes!: number;
}

export class OvertimeRuleDto {
  @IsInt()
  @Min(0)
  thresholdMinutes!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  dailyCapMinutes?: number | null;

  @IsInt()
  @Min(1)
  roundingMinutes!: number;
}

export class HalfDayRuleDto {
  @IsInt()
  @Min(0)
  halfDayThresholdMinutes!: number;
}

export class AbsenceRuleDto {
  @IsBoolean()
  lop!: boolean;
}

export class PolicyRulesDto {
  @ValidateNested()
  @Type(() => LateArrivalRuleDto)
  lateArrival!: LateArrivalRuleDto;

  @ValidateNested()
  @Type(() => EarlyDepartureRuleDto)
  earlyDeparture!: EarlyDepartureRuleDto;

  @ValidateNested()
  @Type(() => OvertimeRuleDto)
  overtime!: OvertimeRuleDto;

  @ValidateNested()
  @Type(() => HalfDayRuleDto)
  halfDay!: HalfDayRuleDto;

  @ValidateNested()
  @Type(() => AbsenceRuleDto)
  absence!: AbsenceRuleDto;
}
