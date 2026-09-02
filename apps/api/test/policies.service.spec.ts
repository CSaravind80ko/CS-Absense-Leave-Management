import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PoliciesService } from '../src/policies/policies.service';
import { resolveEffectivePolicy } from '../src/policies/policy-resolution';
import { PrismaService } from '../src/prisma/prisma.service';

const tenantId = 'de305d54-75b4-431b-adb2-eb6b9e546014';
const versionId = 'c56a4180-65aa-42ec-a945-5fd21dec0538';
const employeeId = '8d11d74a-e6b1-4a4c-9104-59538a65f28d';
const departmentId = '81d4fae4-6c11-4bb5-9170-eea7fe9d9dd0';
const locationId = '11111111-1111-4111-8111-111111111111';

const rules = {
  lateArrival: { graceMinutes: 10 },
  earlyDeparture: { graceMinutes: 10 },
  overtime: { thresholdMinutes: 30, dailyCapMinutes: null, roundingMinutes: 15 },
  halfDay: { halfDayThresholdMinutes: 240 },
  absence: { lop: true },
};

describe('PoliciesService.createDraft', () => {
  it('rejects a scopeId that does not belong to the tenant', async () => {
    const prisma = {
      location: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new PoliciesService(prisma);

    await expect(
      service.createDraft(tenantId, 'actor', {
        scopeType: 'LOCATION',
        scopeId: locationId,
        name: 'Regional Policy',
        effectiveFrom: '2026-08-01',
        workingWeekdays: [1, 2, 3, 4, 5],
        rules,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('forces scopeId to the tenantId for TENANT scope regardless of what is supplied', async () => {
    const create = jest.fn().mockResolvedValue({ id: versionId });
    const tx = {
      policyVersion: { create },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new PoliciesService(prisma);

    await service.createDraft(tenantId, 'actor', {
      scopeType: 'TENANT',
      scopeId: 'some-other-id',
      name: 'Tenant Policy',
      effectiveFrom: '2026-08-01',
      workingWeekdays: [1, 2, 3, 4, 5],
      rules,
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scopeId: tenantId }) }),
    );
  });
});

describe('PoliciesService.updateDraft / deleteDraft', () => {
  it('rejects updating a non-draft version', async () => {
    const prisma = {
      policyVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: versionId, tenantId, status: 'PUBLISHED' }),
      },
    } as unknown as PrismaService;
    const service = new PoliciesService(prisma);

    await expect(
      service.updateDraft(tenantId, versionId, 'actor', { version: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a stale CAS version on update', async () => {
    const tx = { policyVersion: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } };
    const prisma = {
      policyVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: versionId, tenantId, status: 'DRAFT', version: 2 }),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new PoliciesService(prisma);

    await expect(
      service.updateDraft(tenantId, versionId, 'actor', { version: 1, name: 'Renamed' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects deleting a non-draft version', async () => {
    const prisma = {
      policyVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: versionId, tenantId, status: 'PUBLISHED' }),
      },
    } as unknown as PrismaService;
    const service = new PoliciesService(prisma);

    await expect(service.deleteDraft(tenantId, versionId, 'actor')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('PoliciesService.publish', () => {
  function draftVersion(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: versionId,
      tenantId,
      status: 'DRAFT',
      version: 3,
      scopeType: 'TENANT',
      scopeId: tenantId,
      effectiveFrom: new Date('2026-08-01'),
      ...overrides,
    };
  }

  it('rejects publishing a non-draft version', async () => {
    const prisma = {
      policyVersion: {
        findFirst: jest.fn().mockResolvedValue(draftVersion({ status: 'PUBLISHED' })),
      },
    } as unknown as PrismaService;
    const service = new PoliciesService(prisma);

    await expect(
      service.publish(tenantId, versionId, 'actor', { version: 3 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects when a published version for the same scope already has an equal or later effectiveFrom', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(draftVersion({ effectiveFrom: new Date('2026-08-01') }))
      .mockResolvedValueOnce({
        id: 'other-version',
        effectiveFrom: new Date('2026-08-01'),
      });
    const prisma = { policyVersion: { findFirst } } as unknown as PrismaService;
    const service = new PoliciesService(prisma);

    await expect(
      service.publish(tenantId, versionId, 'actor', { version: 3 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an effectiveFrom older than the configured recompute cap', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(draftVersion({ effectiveFrom: new Date('2000-01-01') }))
      .mockResolvedValueOnce(null);
    const prisma = { policyVersion: { findFirst } } as unknown as PrismaService;
    const service = new PoliciesService(prisma);

    await expect(
      service.publish(tenantId, versionId, 'actor', { version: 3 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a stale CAS version on publish', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(draftVersion())
      .mockResolvedValueOnce(null);
    const tx = { policyVersion: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } };
    const prisma = {
      policyVersion: { findFirst },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new PoliciesService(prisma);

    await expect(
      service.publish(tenantId, versionId, 'actor', { version: 3 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates a PolicyRecomputeJob and enqueues a scoped recompute event on success', async () => {
    const draft = draftVersion();
    const findFirst = jest.fn().mockResolvedValueOnce(draft).mockResolvedValueOnce(null);
    const txFindFirstOrThrow = jest.fn().mockResolvedValue({
      ...draft,
      status: 'PUBLISHED',
      version: 4,
    });
    const recomputeJobCreate = jest.fn().mockResolvedValue({ id: 'recompute-job-id' });
    const outboxCreate = jest.fn().mockResolvedValue({});
    const tx = {
      policyVersion: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: txFindFirstOrThrow,
      },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
      policyRecomputeJob: { create: recomputeJobCreate },
      outboxEvent: { create: outboxCreate },
    };
    const prisma = {
      policyVersion: { findFirst },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new PoliciesService(prisma);

    const result = await service.publish(tenantId, versionId, 'actor', { version: 3 });

    expect(recomputeJobCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId,
          scopeType: 'TENANT',
          scopeId: tenantId,
          reason: 'POLICY_PUBLISHED',
          triggeredByPolicyVersionId: versionId,
        }),
      }),
    );
    expect(outboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'attendance.day.recompute-requested.v1' }),
      }),
    );
    expect(result.recomputeJobId).toBe('recompute-job-id');
  });
});

describe('PoliciesService.listEffective', () => {
  it('picks the version with the greatest effectiveFrom per (scopeType, scopeId)', async () => {
    const prisma = {
      policyVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'newer',
            scopeType: 'TENANT',
            scopeId: tenantId,
            effectiveFrom: new Date('2026-08-10'),
          },
          {
            id: 'older',
            scopeType: 'TENANT',
            scopeId: tenantId,
            effectiveFrom: new Date('2026-01-01'),
          },
        ]),
      },
    } as unknown as PrismaService;
    const service = new PoliciesService(prisma);

    const result = await service.listEffective(tenantId);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('newer');
  });
});

describe('PoliciesService.resolve', () => {
  it('maps a resolution failure to NotFoundException', async () => {
    const prisma = {
      employee: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new PoliciesService(prisma);

    await expect(
      service.resolve(tenantId, { employeeId, date: '2026-08-12' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('resolveEffectivePolicy (API copy)', () => {
  const workDate = new Date('2026-08-12');

  function policyVersion(overrides: Partial<Record<string, unknown>>) {
    return {
      id: 'version-id',
      tenantId,
      status: 'PUBLISHED',
      effectiveFrom: new Date('2026-08-01'),
      rules,
      ...overrides,
    };
  }

  it('prefers EMPLOYEE over DEPARTMENT, LOCATION, and TENANT', async () => {
    const prisma = {
      employee: {
        findFirst: jest.fn().mockResolvedValue({
          id: employeeId,
          departmentId,
          locationId,
          groupMemberships: [],
        }),
      },
      policyVersion: {
        findMany: jest.fn().mockResolvedValue([
          policyVersion({ scopeType: 'TENANT', scopeId: tenantId, id: 'tenant-version' }),
          policyVersion({ scopeType: 'LOCATION', scopeId: locationId, id: 'location-version' }),
          policyVersion({ scopeType: 'DEPARTMENT', scopeId: departmentId, id: 'department-version' }),
          policyVersion({ scopeType: 'EMPLOYEE', scopeId: employeeId, id: 'employee-version' }),
        ]),
      },
    } as unknown as PrismaService;

    const result = await resolveEffectivePolicy(prisma, tenantId, employeeId, workDate);
    expect(result.scopeType).toBe('EMPLOYEE');
    expect(result.policyVersion.id).toBe('employee-version');
  });

  it('breaks a group tie by higher priority, then ascending group id', async () => {
    const prisma = {
      employee: {
        findFirst: jest.fn().mockResolvedValue({
          id: employeeId,
          departmentId: null,
          locationId: null,
          groupMemberships: [
            { group: { id: 'group-low', priority: 1 } },
            { group: { id: 'group-high', priority: 10 } },
          ],
        }),
      },
      policyVersion: {
        findMany: jest.fn().mockResolvedValue([
          policyVersion({ scopeType: 'TENANT', scopeId: tenantId, id: 'tenant-version' }),
          policyVersion({ scopeType: 'EMPLOYEE_GROUP', scopeId: 'group-low', id: 'low-version' }),
          policyVersion({ scopeType: 'EMPLOYEE_GROUP', scopeId: 'group-high', id: 'high-version' }),
        ]),
      },
    } as unknown as PrismaService;

    const result = await resolveEffectivePolicy(prisma, tenantId, employeeId, workDate);
    expect(result.policyVersion.id).toBe('high-version');
  });

  it('throws a data-integrity error when even the tenant scope has no match', async () => {
    const prisma = {
      employee: {
        findFirst: jest.fn().mockResolvedValue({
          id: employeeId,
          departmentId: null,
          locationId: null,
          groupMemberships: [],
        }),
      },
      policyVersion: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;

    await expect(
      resolveEffectivePolicy(prisma, tenantId, employeeId, workDate),
    ).rejects.toThrow('data integrity violation');
  });
});
