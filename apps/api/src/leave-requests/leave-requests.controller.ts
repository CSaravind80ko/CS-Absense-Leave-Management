import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApplicationRole } from '@prisma/client';
import { Subject } from '../common/decorators/subject.decorator';
import { TenantId } from '../common/decorators/tenant.decorator';
import { TenantRole } from '../common/decorators/tenant-role.decorator';
import { LeaveRequestsService } from './leave-requests.service';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { LeaveRequestQueryDto } from './dto/leave-request-query.dto';

// No @Roles: submitting is self-service for whoever is linked to an Employee record
// (EmployeesService.getByCognitoSubject enforces that), and listing/reading scopes an
// EMPLOYEE caller to their own requests while every other role can see the tenant's.
// Approve/reject/cancel deliberately reuse POST /approvals/:id/actions rather than adding a
// parallel action endpoint here.
@Controller('leave-requests')
export class LeaveRequestsController {
  constructor(private readonly leaveRequests: LeaveRequestsService) {}

  @Get()
  list(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @TenantRole() role: ApplicationRole,
    @Query() query: LeaveRequestQueryDto,
  ) {
    return this.leaveRequests.list(tenantId, subject, role, query);
  }

  @Get(':id')
  get(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @TenantRole() role: ApplicationRole,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.leaveRequests.get(tenantId, subject, role, id);
  }

  @Post()
  submit(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Body() dto: CreateLeaveRequestDto,
  ) {
    return this.leaveRequests.submit(tenantId, subject, dto);
  }
}
