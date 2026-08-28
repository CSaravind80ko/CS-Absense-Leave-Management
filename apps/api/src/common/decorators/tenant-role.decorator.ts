import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ApplicationRole } from '@prisma/client';
import { AuthenticatedRequest } from '../types/authenticated-request';

export const TenantRole = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ApplicationRole => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.tenantRole;
  },
);
