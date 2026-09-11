import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApplicationRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { TenantId } from '../common/decorators/tenant.decorator';
import { RecomputeJobsService } from './recompute-jobs.service';
import { RecomputeJobQueryDto } from './dto/recompute-job-query.dto';

@Controller('recompute-jobs')
@Roles(
  ApplicationRole.TENANT_ADMIN,
  ApplicationRole.HR_ADMIN,
  ApplicationRole.PAYROLL_ADMIN,
  ApplicationRole.MANAGER,
  ApplicationRole.AUDITOR,
)
export class RecomputeJobsController {
  constructor(private readonly recomputeJobs: RecomputeJobsService) {}

  @Get()
  list(@TenantId() tenantId: string, @Query() query: RecomputeJobQueryDto) {
    return this.recomputeJobs.list(tenantId, query);
  }

  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.recomputeJobs.get(tenantId, id);
  }
}
