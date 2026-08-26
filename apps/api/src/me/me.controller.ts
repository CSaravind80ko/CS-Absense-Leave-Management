import { Controller, Get } from '@nestjs/common';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { Subject } from '../common/decorators/subject.decorator';
import { MeService } from './me.service';

@Controller('me')
@SkipTenant()
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get('tenants')
  listTenants(@Subject() subject: string) {
    return this.me.listTenants(subject);
  }
}
