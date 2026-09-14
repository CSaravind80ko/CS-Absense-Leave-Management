import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApplicationRole } from '@prisma/client';
import { Subject } from '../common/decorators/subject.decorator';
import { TenantId } from '../common/decorators/tenant.decorator';
import { TenantRole } from '../common/decorators/tenant-role.decorator';
import { OnDutyRequestsService } from './on-duty-requests.service';
import { CreateOnDutyRequestDto } from './dto/create-on-duty-request.dto';
import { OnDutyRequestQueryDto } from './dto/on-duty-request-query.dto';

// No @Roles: same convention as leave-requests - submitting is self-service for whoever is
// linked to an Employee record, listing/reading scopes an EMPLOYEE caller to their own
// requests, and approve/reject/cancel reuse POST /approvals/:id/actions.
@Controller('on-duty-requests')
export class OnDutyRequestsController {
  constructor(private readonly onDutyRequests: OnDutyRequestsService) {}

  @Get()
  list(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @TenantRole() role: ApplicationRole,
    @Query() query: OnDutyRequestQueryDto,
  ) {
    return this.onDutyRequests.list(tenantId, subject, role, query);
  }

  @Get(':id')
  get(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @TenantRole() role: ApplicationRole,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.onDutyRequests.get(tenantId, subject, role, id);
  }

  @Post()
  submit(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Body() dto: CreateOnDutyRequestDto,
  ) {
    return this.onDutyRequests.submit(tenantId, subject, dto);
  }
}
