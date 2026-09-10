import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApplicationRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { Subject } from '../common/decorators/subject.decorator';
import { TenantId } from '../common/decorators/tenant.decorator';
import { HolidaysService } from './holidays.service';
import { CreateHolidayDto } from './dto/create-holiday.dto';
import { UpdateHolidayDto } from './dto/update-holiday.dto';
import { HolidayQueryDto } from './dto/holiday-query.dto';

@Controller('holidays')
@Roles(
  ApplicationRole.TENANT_ADMIN,
  ApplicationRole.HR_ADMIN,
  ApplicationRole.PAYROLL_ADMIN,
  ApplicationRole.MANAGER,
  ApplicationRole.AUDITOR,
)
export class HolidaysController {
  constructor(private readonly holidays: HolidaysService) {}

  @Get()
  list(@TenantId() tenantId: string, @Query() query: HolidayQueryDto) {
    return this.holidays.list(tenantId, query);
  }

  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.holidays.get(tenantId, id);
  }

  @Post()
  @Roles(ApplicationRole.TENANT_ADMIN, ApplicationRole.HR_ADMIN)
  create(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Body() dto: CreateHolidayDto,
  ) {
    return this.holidays.create(tenantId, subject, dto);
  }

  @Put(':id')
  @Roles(ApplicationRole.TENANT_ADMIN, ApplicationRole.HR_ADMIN)
  update(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHolidayDto,
  ) {
    return this.holidays.update(tenantId, id, subject, dto);
  }

  @Delete(':id')
  @Roles(ApplicationRole.TENANT_ADMIN, ApplicationRole.HR_ADMIN)
  remove(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.holidays.delete(tenantId, id, subject);
  }
}
