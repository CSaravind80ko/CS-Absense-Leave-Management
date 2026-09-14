import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApplicationRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { Subject } from '../common/decorators/subject.decorator';
import { TenantId } from '../common/decorators/tenant.decorator';
import { TenantRole } from '../common/decorators/tenant-role.decorator';
import { LeaveBalancesService } from './leave-balances.service';
import { SetLeaveBalanceDto } from './dto/set-leave-balance.dto';
import { LeaveBalanceQueryDto } from './dto/leave-balance-query.dto';

// No @Roles on list: an EMPLOYEE reads their own balances (service resolves employeeId from
// their subject); every other role can read anyone's, matching leave-types' read routes.
@Controller('leave-balances')
export class LeaveBalancesController {
  constructor(private readonly leaveBalances: LeaveBalancesService) {}

  @Get()
  list(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @TenantRole() role: ApplicationRole,
    @Query() query: LeaveBalanceQueryDto,
  ) {
    return this.leaveBalances.list(tenantId, subject, role, query);
  }

  @Post()
  @Roles(ApplicationRole.TENANT_ADMIN, ApplicationRole.HR_ADMIN)
  set(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Body() dto: SetLeaveBalanceDto,
  ) {
    return this.leaveBalances.set(tenantId, subject, dto);
  }
}
