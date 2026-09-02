import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ScimAuthService } from './scim-auth.service';
import type { ScimRequest } from './scim-protocol';

@Injectable()
export class ScimAuthGuard implements CanActivate {
  constructor(private readonly auth: ScimAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ScimRequest>();
    const suppliedCorrelation = request.headers['x-correlation-id'];
    request.correlationId =
      typeof suppliedCorrelation === 'string' &&
      /^[A-Za-z0-9._-]{1,128}$/.test(suppliedCorrelation)
        ? suppliedCorrelation
        : randomUUID();
    const authorization = request.headers.authorization;
    const match =
      typeof authorization === 'string'
        ? authorization.match(/^Bearer\s+(\S+)$/i)
        : null;
    if (!match) {
      throw new UnauthorizedException('SCIM bearer token is required');
    }
    request.scim = await this.auth.authenticate(
      request.params.tenantId,
      request.params.samlConnectionId,
      match[1],
      request,
    );
    return true;
  }
}
