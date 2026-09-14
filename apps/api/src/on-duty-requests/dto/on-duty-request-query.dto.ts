import { OnDutyRequestStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PageQueryDto } from '../../common/dto/page-query.dto';

export class OnDutyRequestQueryDto extends PageQueryDto {
  // Ignored for an EMPLOYEE caller, whose own employeeId is always resolved server-side.
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsEnum(OnDutyRequestStatus)
  status?: OnDutyRequestStatus;
}
