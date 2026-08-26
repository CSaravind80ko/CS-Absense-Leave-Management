import { SetMetadata } from '@nestjs/common';
import { ApplicationRole } from '@prisma/client';

export const ROLES_KEY = 'applicationRoles';
export const Roles = (...roles: ApplicationRole[]) => SetMetadata(ROLES_KEY, roles);
