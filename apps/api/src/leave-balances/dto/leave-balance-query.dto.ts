import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class LeaveBalanceQueryDto {
  // Ignored for an EMPLOYEE caller, whose own employeeId is always resolved server-side.
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2100)
  year?: number;
}
