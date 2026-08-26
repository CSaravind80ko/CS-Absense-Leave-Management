import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Subject } from '../common/decorators/subject.decorator';
import { TenantId } from '../common/decorators/tenant.decorator';
import { AttendanceService } from './attendance.service';
import { CreateImportJobDto } from './dto/create-import-job.dto';
import { CreatePeriodDto } from './dto/create-period.dto';
import { UpdatePeriodStatusDto } from './dto/update-period-status.dto';
import { ApplicationRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('attendance')
@Roles(
  ApplicationRole.TENANT_ADMIN,
  ApplicationRole.HR_ADMIN,
  ApplicationRole.PAYROLL_ADMIN,
  ApplicationRole.AUDITOR,
)
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('periods')
  listPeriods(@TenantId() tenantId: string) {
    return this.attendance.listPeriods(tenantId);
  }

  @Post('periods')
  @Roles(ApplicationRole.TENANT_ADMIN, ApplicationRole.HR_ADMIN)
  createPeriod(@TenantId() tenantId: string, @Body() dto: CreatePeriodDto) {
    return this.attendance.createPeriod(tenantId, dto);
  }

  @Patch('periods/:id/status')
  @Roles(ApplicationRole.TENANT_ADMIN, ApplicationRole.HR_ADMIN)
  updatePeriodStatus(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePeriodStatusDto,
  ) {
    return this.attendance.updatePeriodStatus(tenantId, id, dto.status);
  }

  @Get('imports')
  listImports(
    @TenantId() tenantId: string,
    @Query('periodId', new ParseUUIDPipe({ optional: true })) periodId?: string,
  ) {
    return this.attendance.listImportJobs(tenantId, periodId);
  }

  @Post('imports')
  @Roles(ApplicationRole.TENANT_ADMIN, ApplicationRole.HR_ADMIN)
  createImport(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Body() dto: CreateImportJobDto,
  ) {
    return this.attendance.createImportJob(tenantId, subject, dto);
  }
}
