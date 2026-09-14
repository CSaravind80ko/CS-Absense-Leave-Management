import { IsInt, IsNumber, IsUUID, Max, Min } from 'class-validator';

export class SetLeaveBalanceDto {
  @IsUUID()
  employeeId!: string;

  @IsUUID()
  leaveTypeId!: string;

  @IsInt()
  @Min(2020)
  @Max(2100)
  year!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(365)
  allocatedDays!: number;
}
