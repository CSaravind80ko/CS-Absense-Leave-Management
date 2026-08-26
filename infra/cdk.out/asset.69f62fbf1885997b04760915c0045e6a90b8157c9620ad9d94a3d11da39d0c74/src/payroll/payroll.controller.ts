import { Body, Controller, Get, Post } from '@nestjs/common';
import { Subject } from '../common/decorators/subject.decorator';
import { TenantId } from '../common/decorators/tenant.decorator';
import { CreatePayrollExportDto } from './dto/create-payroll-export.dto';
import { PayrollService } from './payroll.service';
import { ApplicationRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('payroll/exports')
@Roles(
  ApplicationRole.TENANT_ADMIN,
  ApplicationRole.HR_ADMIN,
  ApplicationRole.PAYROLL_ADMIN,
  ApplicationRole.AUDITOR,
)
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get()
  list(@TenantId() tenantId: string) {
    return this.payroll.list(tenantId);
  }

  @Post()
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
