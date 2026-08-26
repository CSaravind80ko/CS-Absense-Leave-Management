import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthenticatedRequest } from '../types/authenticated-request';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
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

    const membership = await this.prisma.tenantMembership.findUnique({
      where: {
        tenantId_cognitoSubject: {
          tenantId: value,
          cognitoSubject: request.auth.subject,
        },
      },
      select: { active: true, tenant: { select: { status: true } } },
    });
    if (!membership?.active || membership.tenant.status !== 'ACTIVE') {
      throw new ForbiddenException('No active membership for this tenant');
    }

    request.tenantId = value;
    return true;
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }
}
