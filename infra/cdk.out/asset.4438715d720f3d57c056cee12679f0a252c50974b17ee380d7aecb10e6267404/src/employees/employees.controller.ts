import { Body, Controller, Get, Param, Patch, Post, ParseUUIDPipe } from '@nestjs/common';
import { TenantId } from '../common/decorators/tenant.decorator';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeesService } from './employees.service';

@Controller('employees')
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
  create(@TenantId() tenantId: string, @Body() dto: CreateEmployeeDto) {
    return this.employees.create(tenantId, dto);
  }

  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employees.update(tenantId, id, dto);
  }
}
