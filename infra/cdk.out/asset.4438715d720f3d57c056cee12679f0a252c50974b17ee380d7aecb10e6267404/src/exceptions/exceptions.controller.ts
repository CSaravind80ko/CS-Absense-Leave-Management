import { Body, Controller, Get, Param, ParseEnumPipe, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ExceptionStatus } from '@prisma/client';
import { Subject } from '../common/decorators/subject.decorator';
import { TenantId } from '../common/decorators/tenant.decorator';
import { DecideExceptionDto } from './dto/decide-exception.dto';
import { ExceptionsService } from './exceptions.service';

@Controller('exceptions')
export class ExceptionsController {
  constructor(private readonly exceptions: ExceptionsService) {}

  @Get()
  list(
    @TenantId() tenantId: string,
    @Query('status', new ParseEnumPipe(ExceptionStatus, { optional: true }))
    status?: ExceptionStatus,
  ) {
    return this.exceptions.list(tenantId, status);
  }

  @Patch(':id/decision')
  decide(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideExceptionDto,
  ) {
    return this.exceptions.decide(tenantId, id, subject, dto);
  }
}
