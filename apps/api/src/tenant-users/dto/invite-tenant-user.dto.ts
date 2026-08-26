import { ApplicationRole } from '@prisma/client';
import { IsBoolean, IsEmail, IsEnum, IsOptional } from 'class-validator';

export class InviteTenantUserDto {
  @IsEmail()
  email!: string;

  @IsEnum(ApplicationRole)
  role!: ApplicationRole;

  @IsOptional()
  @IsBoolean()
  mfaRequired?: boolean;
}
