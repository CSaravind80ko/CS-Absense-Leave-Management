import { Body, Controller, Get, Param, ParseEnumPipe, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApprovalStatus } from '@prisma/client';
import { Subject } from '../common/decorators/subject.decorator';
import { TenantId } from '../common/decorators/tenant.decorator';
import { ApprovalActionDto } from './dto/approval-action.dto';
import { CreateApprovalDto } from './dto/create-approval.dto';
import { ApprovalsService } from './approvals.service';

@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get()
  list(
    @TenantId() tenantId: string,
    @Query('status', new ParseEnumPipe(ApprovalStatus, { optional: true }))
    status?: ApprovalStatus,
  ) {
    return this.approvals.list(tenantId, status);
  }

  @Post()
  create(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Body() dto: CreateApprovalDto,
  ) {
    return this.approvals.create(tenantId, subject, dto);
  }

  @Post(':id/actions')
  act(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApprovalActionDto,
  ) {
    return this.approvals.act(tenantId, id, subject, dto);
  }
}
