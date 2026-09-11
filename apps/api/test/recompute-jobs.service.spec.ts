import { NotFoundException } from '@nestjs/common';
import { RecomputeJobsService } from '../src/recompute-jobs/recompute-jobs.service';
import { PrismaService } from '../src/prisma/prisma.service';

const tenantId = 'de305d54-75b4-431b-adb2-eb6b9e546014';
const jobId = 'c56a4180-65aa-42ec-a945-5fd21dec0538';

describe('RecomputeJobsService.list', () => {
  it('scopes the query to the tenant and applies the optional status filter', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = {
      policyRecomputeJob: { findMany, count },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    } as unknown as PrismaService;
    const service = new RecomputeJobsService(prisma);

    await service.list(tenantId, { page: 1, pageSize: 25, order: 'desc', status: 'FAILED' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId, status: 'FAILED' } }),
    );
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId, status: 'FAILED' } }),
    );
  });

  it('paginates using page/pageSize and orders by createdAt', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      policyRecomputeJob: { findMany, count: jest.fn().mockResolvedValue(60) },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    } as unknown as PrismaService;
    const service = new RecomputeJobsService(prisma);

    const result = await service.list(tenantId, { page: 3, pageSize: 20, order: 'asc' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'asc' }, skip: 40, take: 20 }),
    );
    expect(result.totalPages).toBe(3);
  });
});

describe('RecomputeJobsService.get', () => {
  it('throws NotFoundException for a job outside the tenant', async () => {
    const prisma = {
      policyRecomputeJob: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new RecomputeJobsService(prisma);

    await expect(service.get(tenantId, jobId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the job when it belongs to the tenant', async () => {
    const job = { id: jobId, tenantId, status: 'COMPLETED' };
    const prisma = {
      policyRecomputeJob: { findFirst: jest.fn().mockResolvedValue(job) },
    } as unknown as PrismaService;
    const service = new RecomputeJobsService(prisma);

    await expect(service.get(tenantId, jobId)).resolves.toBe(job);
  });
});
