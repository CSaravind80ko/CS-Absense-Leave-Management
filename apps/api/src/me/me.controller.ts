import { Controller, Get, Req } from '@nestjs/common';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { AuthenticatedRequest } from '../common/types/authenticated-request';
import { MeService } from './me.service';

@Controller('me')
@SkipTenant()
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get('tenants')
  listTenants(@Req() request: AuthenticatedRequest) {
    return this.me.listTenants(
      request.auth.connectionId,
      request.auth.subject,
    );
  }
}
