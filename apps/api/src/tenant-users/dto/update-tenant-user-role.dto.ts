import { ApplicationRole } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateTenantUserRoleDto {
  @IsEnum(ApplicationRole)
  role!: ApplicationRole;
}
