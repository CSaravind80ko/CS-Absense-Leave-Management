import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApplicationRole } from '@prisma/client';
import { Subject } from '../common/decorators/subject.decorator';
import { TenantId } from '../common/decorators/tenant.decorator';
import { TenantRole } from '../common/decorators/tenant-role.decorator';
import { CompOffCreditsService } from './comp-off-credits.service';
import { CreateCompOffCreditDto } from './dto/create-comp-off-credit.dto';
import { CompOffCreditQueryDto } from './dto/comp-off-credit-query.dto';

// No @Roles: same convention as leave-requests/on-duty-requests - submitting and the
// eligible-days lookup are self-service, listing/reading scopes an EMPLOYEE caller to their
// own claims, and approve/reject/cancel reuse POST /approvals/:id/actions.
@Controller('comp-off-credits')
export class CompOffCreditsController {
  constructor(private readonly compOffCredits: CompOffCreditsService) {}

  @Get()
  list(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @TenantRole() role: ApplicationRole,
    @Query() query: CompOffCreditQueryDto,
  ) {
    return this.compOffCredits.list(tenantId, subject, role, query);
  }

  // Must come before ':id' - otherwise ParseUUIDPipe would try to parse "eligible-days" as a
  // UUID and this route would never be reached.
  @Get('eligible-days')
  eligibleDays(@TenantId() tenantId: string, @Subject() subject: string) {
    return this.compOffCredits.listEligibleDays(tenantId, subject);
  }

  @Get(':id')
  get(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @TenantRole() role: ApplicationRole,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.compOffCredits.get(tenantId, subject, role, id);
  }

  @Post()
  submit(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Body() dto: CreateCompOffCreditDto,
  ) {
    return this.compOffCredits.submit(tenantId, subject, dto);
  }
}
