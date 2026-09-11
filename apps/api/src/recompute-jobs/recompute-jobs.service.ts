import { Injectable, NotFoundException } from '@nestjs/common';
import { PolicyRecomputeJob, Prisma } from '@prisma/client';
import { PageResult, pageResult } from '../common/dto/page-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import { RecomputeJobQueryDto } from './dto/recompute-job-query.dto';

// Read-only surface for PolicyRecomputeJob: the row is created and driven entirely by
// PoliciesService.publish, EmployeeGroupsService, and HolidaysService (and claimed/completed
// by apps/worker's processor), so this module only ever lists and reads.
@Injectable()
export class RecomputeJobsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    tenantId: string,
    query: RecomputeJobQueryDto,
  ): Promise<PageResult<PolicyRecomputeJob>> {
    const where: Prisma.PolicyRecomputeJobWhereInput = { tenantId, status: query.status };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.policyRecomputeJob.findMany({
        where,
        orderBy: { createdAt: query.order },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.policyRecomputeJob.count({ where }),
    ]);
    return pageResult(items, total, query);
  }

  async get(tenantId: string, id: string): Promise<PolicyRecomputeJob> {
    const job = await this.prisma.policyRecomputeJob.findFirst({ where: { id, tenantId } });
    if (!job) throw new NotFoundException('Recompute job not found');
    return job;
  }
}
