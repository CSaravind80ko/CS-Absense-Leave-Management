import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApplicationRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { Subject } from '../common/decorators/subject.decorator';
import { TenantId } from '../common/decorators/tenant.decorator';
import { DecideExceptionDto } from './dto/decide-exception.dto';
import {
  AssignExceptionDto,
  ExceptionQueryDto,
} from './dto/exception-query.dto';
import { ExceptionsService } from './exceptions.service';

@Controller('exceptions')
@Roles(
  ApplicationRole.TENANT_ADMIN,
  ApplicationRole.HR_ADMIN,
  ApplicationRole.MANAGER,
  ApplicationRole.PAYROLL_ADMIN,
  ApplicationRole.AUDITOR,
)
export class ExceptionsController {
  constructor(private readonly exceptions: ExceptionsService) {}

  @Get()
  list(@TenantId() tenantId: string, @Query() query: ExceptionQueryDto) {
    return this.exceptions.list(tenantId, query);
  }

  @Get(':id')
  get(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.exceptions.get(tenantId, id);
  }

  @Patch(':id/assignment')
  @Roles(
    ApplicationRole.TENANT_ADMIN,
    ApplicationRole.HR_ADMIN,
    ApplicationRole.MANAGER,
  )
  assign(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignExceptionDto,
  ) {
    return this.exceptions.assign(tenantId, id, subject, dto);
  }

  @Patch(':id/decision')
  @Roles(
    ApplicationRole.TENANT_ADMIN,
    ApplicationRole.HR_ADMIN,
    ApplicationRole.MANAGER,
  )
  decide(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideExceptionDto,
  ) {
    return this.exceptions.decide(tenantId, id, subject, dto);
  }
}
