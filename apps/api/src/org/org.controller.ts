import { Controller, Get } from '@nestjs/common';
import { ApplicationRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { TenantId } from '../common/decorators/tenant.decorator';
import { OrgService } from './org.service';

@Controller()
@Roles(
  ApplicationRole.TENANT_ADMIN,
  ApplicationRole.HR_ADMIN,
  ApplicationRole.PAYROLL_ADMIN,
  ApplicationRole.MANAGER,
  ApplicationRole.AUDITOR,
)
export class OrgController {
  constructor(private readonly org: OrgService) {}

  @Get('departments')
  listDepartments(@TenantId() tenantId: string) {
    return this.org.listDepartments(tenantId);
  }

  @Get('locations')
  listLocations(@TenantId() tenantId: string) {
    return this.org.listLocations(tenantId);
  }
}
