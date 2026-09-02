import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IdentityMembershipService } from '../../auth/identity-membership.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SKIP_TENANT_KEY } from '../decorators/skip-tenant.decorator';
import { AuthenticatedRequest } from '../types/authenticated-request';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly identities: IdentityMembershipService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      [IS_PUBLIC_KEY, SKIP_TENANT_KEY].some((key) =>
        this.reflector.getAllAndOverride<boolean>(key, [
          context.getHandler(),
          context.getClass(),
        ]),
      )
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const value = request.headers['x-tenant-id'];
    if (typeof value !== 'string' || !this.isUuid(value)) {
      throw new BadRequestException('A valid X-Tenant-Id header is required');
    }
    if (!request.auth?.subject) {
      throw new ForbiddenException('Authenticated subject is required');
    }

    const membership = await this.identities.find(
      request.auth.connectionId,
      request.auth.subject,
      value,
    );
    if (!membership?.active || membership.tenant.status !== 'ACTIVE') {
      throw new ForbiddenException('No active membership for this tenant');
    }

    request.tenantId = value;
    request.tenantRole = membership.role;
    return true;
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }
}
