import { Controller, Get, Query } from '@nestjs/common';
import { ApplicationRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { TenantId } from '../common/decorators/tenant.decorator';
import { AttendanceSummaryQueryDto } from './dto/attendance-summary-query.dto';
import { ExceptionTrendsQueryDto } from './dto/exception-trends-query.dto';
import { LeaveUtilizationQueryDto } from './dto/leave-utilization-query.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
@Roles(
  ApplicationRole.TENANT_ADMIN,
  ApplicationRole.HR_ADMIN,
  ApplicationRole.PAYROLL_ADMIN,
  ApplicationRole.AUDITOR,
)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('attendance-summary')
  attendanceSummary(
    @TenantId() tenantId: string,
    @Query() query: AttendanceSummaryQueryDto,
  ) {
    return this.reports.attendanceSummaryByDepartment(tenantId, query.periodId);
  }

  @Get('exception-trends')
  exceptionTrends(
    @TenantId() tenantId: string,
    @Query() query: ExceptionTrendsQueryDto,
  ) {
    return this.reports.exceptionTrends(tenantId, query.periodIds);
  }

  @Get('leave-utilization')
  leaveUtilization(
    @TenantId() tenantId: string,
    @Query() query: LeaveUtilizationQueryDto,
  ) {
    return this.reports.leaveUtilization(tenantId, query.year);
  }
}
