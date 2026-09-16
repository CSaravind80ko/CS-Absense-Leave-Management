import { IsUUID } from 'class-validator';

export class AttendanceSummaryQueryDto {
  @IsUUID()
  periodId!: string;
}
