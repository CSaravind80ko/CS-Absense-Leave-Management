import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApplicationRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { Subject } from '../common/decorators/subject.decorator';
import { TenantId } from '../common/decorators/tenant.decorator';
import { LeaveTypesService } from './leave-types.service';
import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { UpdateLeaveTypeDto } from './dto/update-leave-type.dto';

// No @Roles here: every authenticated tenant member (including EMPLOYEE) needs to read leave
// types to submit a leave request, so the list/get routes are intentionally unrestricted.
@Controller('leave-types')
export class LeaveTypesController {
  constructor(private readonly leaveTypes: LeaveTypesService) {}

  @Get()
  list(@TenantId() tenantId: string, @Query('includeInactive') includeInactive?: string) {
    return this.leaveTypes.list(tenantId, includeInactive === 'true');
  }

  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.leaveTypes.get(tenantId, id);
  }

  @Post()
  @Roles(ApplicationRole.TENANT_ADMIN, ApplicationRole.HR_ADMIN)
  create(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Body() dto: CreateLeaveTypeDto,
  ) {
    return this.leaveTypes.create(tenantId, subject, dto);
  }

  @Put(':id')
  @Roles(ApplicationRole.TENANT_ADMIN, ApplicationRole.HR_ADMIN)
  update(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeaveTypeDto,
  ) {
    return this.leaveTypes.update(tenantId, id, subject, dto);
  }
}
