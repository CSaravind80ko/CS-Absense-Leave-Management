import { IsUUID } from 'class-validator';

export class AddGroupMemberDto {
  @IsUUID()
  employeeId!: string;
}
