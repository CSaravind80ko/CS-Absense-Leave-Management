import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApplicationRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { Subject } from '../common/decorators/subject.decorator';
import { TenantId } from '../common/decorators/tenant.decorator';
import { AttendanceService } from './attendance.service';
import {
  AttendanceRegisterQueryDto,
  DashboardQueryDto,
  ImportQueryDto,
  PeriodQueryDto,
} from './dto/attendance-query.dto';
import { CreateImportJobDto } from './dto/create-import-job.dto';
import { CreateImportUploadDto } from './dto/create-import-upload.dto';
import { CreatePeriodDto } from './dto/create-period.dto';
import { ImportStorageService } from './import-storage.service';
import { UpdatePeriodStatusDto } from './dto/update-period-status.dto';

@Controller('attendance')
@Roles(
  ApplicationRole.TENANT_ADMIN,
  ApplicationRole.HR_ADMIN,
  ApplicationRole.PAYROLL_ADMIN,
  ApplicationRole.MANAGER,
  ApplicationRole.AUDITOR,
)
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly storage: ImportStorageService,
  ) {}

  @Get('periods')
  listPeriods(@TenantId() tenantId: string, @Query() query: PeriodQueryDto) {
    return this.attendance.listPeriods(tenantId, query);
  }

  @Get('periods/:id')
  getPeriod(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.attendance.getPeriod(tenantId, id);
  }

  @Post('periods')
  @Roles(ApplicationRole.TENANT_ADMIN, ApplicationRole.HR_ADMIN)
  createPeriod(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Body() dto: CreatePeriodDto,
  ) {
    return this.attendance.createPeriod(tenantId, subject, dto);
  }

  @Patch('periods/:id/status')
  @Roles(ApplicationRole.TENANT_ADMIN, ApplicationRole.HR_ADMIN)
  updatePeriodStatus(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePeriodStatusDto,
  ) {
    return this.attendance.updatePeriodStatus(tenantId, id, subject, dto);
  }

  @Get('register')
  listRegister(
    @TenantId() tenantId: string,
    @Query() query: AttendanceRegisterQueryDto,
  ) {
    return this.attendance.listRegister(tenantId, query);
  }

  @Get('days/:id')
  getAttendanceDay(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.attendance.getAttendanceDay(tenantId, id);
  }

  @Get('dashboard')
  dashboard(
    @TenantId() tenantId: string,
    @Query() query: DashboardQueryDto,
  ) {
    return this.attendance.dashboard(tenantId, query);
  }

  @Get('imports')
  listImports(@TenantId() tenantId: string, @Query() query: ImportQueryDto) {
    return this.attendance.listImportJobs(tenantId, query);
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

  @Get('imports/:id')
  getImport(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.attendance.getImportJob(tenantId, id);
  }

  @Post('imports/:id/uploads')
  @Roles(ApplicationRole.TENANT_ADMIN, ApplicationRole.HR_ADMIN)
  createImportUpload(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateImportUploadDto,
  ) {
    return this.storage.createUpload(tenantId, id, dto);
  }

  @Post('imports/:id/uploads/:uploadId/finalize')
  @Roles(ApplicationRole.TENANT_ADMIN, ApplicationRole.HR_ADMIN)
  finalizeImportUpload(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
  ) {
    return this.storage.finalizeUpload(tenantId, id, uploadId, subject);
  }
}
