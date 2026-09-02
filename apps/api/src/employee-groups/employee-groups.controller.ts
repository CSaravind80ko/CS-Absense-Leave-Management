import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApplicationRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { Subject } from '../common/decorators/subject.decorator';
import { TenantId } from '../common/decorators/tenant.decorator';
import { EmployeeGroupsService } from './employee-groups.service';
import { CreateEmployeeGroupDto } from './dto/create-employee-group.dto';
import { UpdateEmployeeGroupDto } from './dto/update-employee-group.dto';
import { AddGroupMemberDto } from './dto/add-group-member.dto';

@Controller('employee-groups')
@Roles(
  ApplicationRole.TENANT_ADMIN,
  ApplicationRole.HR_ADMIN,
  ApplicationRole.PAYROLL_ADMIN,
  ApplicationRole.MANAGER,
  ApplicationRole.AUDITOR,
)
export class EmployeeGroupsController {
  constructor(private readonly employeeGroups: EmployeeGroupsService) {}

  @Get()
  list(@TenantId() tenantId: string) {
    return this.employeeGroups.list(tenantId);
  }

  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.employeeGroups.get(tenantId, id);
  }

  @Post()
  @Roles(ApplicationRole.TENANT_ADMIN, ApplicationRole.HR_ADMIN)
  create(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Body() dto: CreateEmployeeGroupDto,
  ) {
    return this.employeeGroups.create(tenantId, subject, dto);
  }

  @Put(':id')
  @Roles(ApplicationRole.TENANT_ADMIN, ApplicationRole.HR_ADMIN)
  update(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeGroupDto,
  ) {
    return this.employeeGroups.update(tenantId, id, subject, dto);
  }

  @Post(':id/members')
  @Roles(ApplicationRole.TENANT_ADMIN, ApplicationRole.HR_ADMIN)
  addMember(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddGroupMemberDto,
  ) {
    return this.employeeGroups.addMember(tenantId, id, subject, dto);
  }

  @Delete(':id/members/:employeeId')
  @Roles(ApplicationRole.TENANT_ADMIN, ApplicationRole.HR_ADMIN)
  removeMember(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
  ) {
    return this.employeeGroups.removeMember(tenantId, id, employeeId, subject);
  }
}
