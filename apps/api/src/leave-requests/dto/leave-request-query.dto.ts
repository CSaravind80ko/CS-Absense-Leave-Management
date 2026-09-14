import { LeaveRequestStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PageQueryDto } from '../../common/dto/page-query.dto';

export class LeaveRequestQueryDto extends PageQueryDto {
  // Ignored for an EMPLOYEE caller, whose own employeeId is always resolved server-side.
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsEnum(LeaveRequestStatus)
  status?: LeaveRequestStatus;

  @IsOptional()
  @IsUUID()
  leaveTypeId?: string;
}
