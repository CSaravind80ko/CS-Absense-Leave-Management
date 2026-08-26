import { Body, Controller, Get, Param, Patch, Post, ParseUUIDPipe } from '@nestjs/common';
import { TenantId } from '../common/decorators/tenant.decorator';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeesService } from './employees.service';
import { ApplicationRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('employees')
@Roles(
  ApplicationRole.TENANT_ADMIN,
  ApplicationRole.HR_ADMIN,
  ApplicationRole.PAYROLL_ADMIN,
  ApplicationRole.AUDITOR,
)
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  list(@TenantId() tenantId: string) {
    return this.employees.list(tenantId);
  }

  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.employees.get(tenantId, id);
  }

  @Post()
  @Roles(ApplicationRole.TENANT_ADMIN, ApplicationRole.HR_ADMIN)
  create(@TenantId() tenantId: string, @Body() dto: CreateEmployeeDto) {
    return this.employees.create(tenantId, dto);
  }

  @Patch(':id')
  @Roles(ApplicationRole.TENANT_ADMIN, ApplicationRole.HR_ADMIN)
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employees.update(tenantId, id, dto);
  }
}
