import { Controller, Get, Query } from '@nestjs/common';
import { ApplicationRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { TenantId } from '../common/decorators/tenant.decorator';
import { AuditEventsService } from './audit-events.service';
import { AuditEventQueryDto } from './dto/audit-event-query.dto';

@Controller('audit-events')
@Roles(
  ApplicationRole.TENANT_ADMIN,
  ApplicationRole.HR_ADMIN,
  ApplicationRole.PAYROLL_ADMIN,
  ApplicationRole.MANAGER,
  ApplicationRole.AUDITOR,
)
export class AuditEventsController {
  constructor(private readonly auditEvents: AuditEventsService) {}

  @Get()
  list(@TenantId() tenantId: string, @Query() query: AuditEventQueryDto) {
    return this.auditEvents.list(tenantId, query);
  }

  @Get('entity-types')
  listEntityTypes(@TenantId() tenantId: string) {
    return this.auditEvents.listEntityTypes(tenantId);
  }
}
