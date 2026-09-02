import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApplicationRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { Subject } from '../common/decorators/subject.decorator';
import { TenantId } from '../common/decorators/tenant.decorator';
import { TenantRole } from '../common/decorators/tenant-role.decorator';
import { ApprovalActionDto } from './dto/approval-action.dto';
import { ApprovalQueryDto } from './dto/approval-query.dto';
import { CreateApprovalDto } from './dto/create-approval.dto';
import { ApprovalsService } from './approvals.service';

@Controller('approvals')
@Roles(
  ApplicationRole.TENANT_ADMIN,
  ApplicationRole.HR_ADMIN,
  ApplicationRole.PAYROLL_ADMIN,
  ApplicationRole.MANAGER,
  ApplicationRole.AUDITOR,
)
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get()
  list(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @TenantRole() role: ApplicationRole,
    @Query() query: ApprovalQueryDto,
  ) {
    return this.approvals.list(tenantId, subject, role, query);
  }

  @Get(':id')
  get(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.approvals.get(tenantId, id);
  }

  @Post()
  @Roles(
    ApplicationRole.TENANT_ADMIN,
    ApplicationRole.HR_ADMIN,
    ApplicationRole.PAYROLL_ADMIN,
    ApplicationRole.MANAGER,
  )
  create(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Body() dto: CreateApprovalDto,
  ) {
    return this.approvals.create(tenantId, subject, dto);
  }

  @Post(':id/actions')
  @Roles(
    ApplicationRole.TENANT_ADMIN,
    ApplicationRole.HR_ADMIN,
    ApplicationRole.PAYROLL_ADMIN,
    ApplicationRole.MANAGER,
  )
  act(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @TenantRole() role: ApplicationRole,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApprovalActionDto,
  ) {
    return this.approvals.act(tenantId, id, subject, role, dto);
  }
}
