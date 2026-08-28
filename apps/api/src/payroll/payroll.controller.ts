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
import { CreatePayrollExportDto } from './dto/create-payroll-export.dto';
import {
  PayrollExportQueryDto,
  PayrollRegisterQueryDto,
} from './dto/payroll-query.dto';
import { PayrollService } from './payroll.service';
import { PayrollFilesService } from './payroll-files.service';

@Controller('payroll')
@Roles(
  ApplicationRole.TENANT_ADMIN,
  ApplicationRole.HR_ADMIN,
  ApplicationRole.PAYROLL_ADMIN,
  ApplicationRole.AUDITOR,
)
export class PayrollController {
  constructor(
    private readonly payroll: PayrollService,
    private readonly files: PayrollFilesService,
  ) {}

  @Get('register')
  register(
    @TenantId() tenantId: string,
    @Query() query: PayrollRegisterQueryDto,
  ) {
    return this.payroll.register(tenantId, query);
  }

  @Get('exports')
  listExports(
    @TenantId() tenantId: string,
    @Query() query: PayrollExportQueryDto,
  ) {
    return this.payroll.listExports(tenantId, query);
  }

  @Get('exports/:id')
  getExport(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.payroll.getExport(tenantId, id);
  }

  @Get('exports/:id/download')
  downloadExport(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.files.createDownload(tenantId, id);
  }

  @Post('exports')
  @Roles(
    ApplicationRole.TENANT_ADMIN,
    ApplicationRole.HR_ADMIN,
    ApplicationRole.PAYROLL_ADMIN,
  )
  create(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Body() dto: CreatePayrollExportDto,
  ) {
    return this.payroll.create(tenantId, subject, dto);
  }
}
