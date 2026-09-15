import { IsEnum } from 'class-validator';
import { AttendanceSourceConnectionStatus } from '@prisma/client';

export class UpdateConnectionStatusDto {
  @IsEnum(AttendanceSourceConnectionStatus)
  status!: AttendanceSourceConnectionStatus;
}
