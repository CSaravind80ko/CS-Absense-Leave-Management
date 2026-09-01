import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EmployeeGroupsService } from '../src/employee-groups/employee-groups.service';
import { PrismaService } from '../src/prisma/prisma.service';

const tenantId = 'de305d54-75b4-431b-adb2-eb6b9e546014';
const groupId = 'c56a4180-65aa-42ec-a945-5fd21dec0538';
const employeeId = '8d11d74a-e6b1-4a4c-9104-59538a65f28d';

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('EmployeeGroupsService.create', () => {
  it('maps a duplicate code to ConflictException', async () => {
    const prisma = {
      $transaction: jest.fn().mockRejectedValue(uniqueViolation()),
    } as unknown as PrismaService;
    const service = new EmployeeGroupsService(prisma);

    await expect(
      service.create(tenantId, 'actor', { name: 'Flex', code: 'FLEX' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('EmployeeGroupsService.update', () => {
  it('enqueues an EMPLOYEE_GROUP-scoped recompute when priority changes', async () => {
    const recomputeJobCreate = jest.fn().mockResolvedValue({ id: 'job-id' });
    const outboxCreate = jest.fn().mockResolvedValue({});
    const tx = {
      employeeGroup: { update: jest.fn().mockResolvedValue({ id: groupId, name: 'Flex', priority: 20 }) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
      policyRecomputeJob: { create: recomputeJobCreate },
      outboxEvent: { create: outboxCreate },
    };
    const prisma = {
      employeeGroup: {
        findFirst: jest.fn().mockResolvedValue({ id: groupId, tenantId, name: 'Flex', priority: 5 }),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new EmployeeGroupsService(prisma);

    await service.update(tenantId, groupId, 'actor', { priority: 20 });

    expect(recomputeJobCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ scopeType: 'EMPLOYEE_GROUP', scopeId: groupId }),
      }),
    );
    expect(outboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'attendance.day.recompute-requested.v1' }),
      }),
    );
  });

  it('does not enqueue a recompute when priority is unchanged', async () => {
    const recomputeJobCreate = jest.fn().mockResolvedValue({ id: 'job-id' });
    const tx = {
      employeeGroup: { update: jest.fn().mockResolvedValue({ id: groupId, name: 'Flex Renamed', priority: 5 }) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
      policyRecomputeJob: { create: recomputeJobCreate },
      outboxEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      employeeGroup: {
        findFirst: jest.fn().mockResolvedValue({ id: groupId, tenantId, name: 'Flex', priority: 5 }),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new EmployeeGroupsService(prisma);

    await service.update(tenantId, groupId, 'actor', { name: 'Flex Renamed' });

    expect(recomputeJobCreate).not.toHaveBeenCalled();
  });
});

describe('EmployeeGroupsService.addMember', () => {
  it('enqueues an EMPLOYEE-scoped recompute, not a group-wide one', async () => {
    const recomputeJobCreate = jest.fn().mockResolvedValue({ id: 'job-id' });
    const outboxCreate = jest.fn().mockResolvedValue({});
    const tx = {
      employeeGroupMember: { create: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
      policyRecomputeJob: { create: recomputeJobCreate },
      outboxEvent: { create: outboxCreate },
    };
    const prisma = {
      employeeGroup: { findFirst: jest.fn().mockResolvedValue({ id: groupId, tenantId }) },
      employee: { findFirst: jest.fn().mockResolvedValue({ id: employeeId, tenantId }) },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new EmployeeGroupsService(prisma);

    await service.addMember(tenantId, groupId, 'actor', { employeeId });

    expect(recomputeJobCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ scopeType: 'EMPLOYEE', scopeId: employeeId }),
      }),
    );
    expect(outboxCreate).toHaveBeenCalled();
  });

  it('maps a duplicate membership to ConflictException', async () => {
    const tx = {
      employeeGroupMember: { create: jest.fn().mockRejectedValue(uniqueViolation()) },
    };
    const prisma = {
      employeeGroup: { findFirst: jest.fn().mockResolvedValue({ id: groupId, tenantId }) },
      employee: { findFirst: jest.fn().mockResolvedValue({ id: employeeId, tenantId }) },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new EmployeeGroupsService(prisma);

    await expect(
      service.addMember(tenantId, groupId, 'actor', { employeeId }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects adding a member that does not belong to the tenant', async () => {
    const prisma = {
      employeeGroup: { findFirst: jest.fn().mockResolvedValue({ id: groupId, tenantId }) },
      employee: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new EmployeeGroupsService(prisma);

    await expect(
      service.addMember(tenantId, groupId, 'actor', { employeeId }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('EmployeeGroupsService.removeMember', () => {
  it('enqueues an EMPLOYEE-scoped recompute on removal', async () => {
    const recomputeJobCreate = jest.fn().mockResolvedValue({ id: 'job-id' });
    const tx = {
      employeeGroupMember: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
      policyRecomputeJob: { create: recomputeJobCreate },
      outboxEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      employeeGroup: { findFirst: jest.fn().mockResolvedValue({ id: groupId, tenantId }) },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new EmployeeGroupsService(prisma);

    await service.removeMember(tenantId, groupId, employeeId, 'actor');

    expect(recomputeJobCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ scopeType: 'EMPLOYEE', scopeId: employeeId }),
      }),
    );
  });

  it('404s when the employee is not currently a member', async () => {
    const tx = {
      employeeGroupMember: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const prisma = {
      employeeGroup: { findFirst: jest.fn().mockResolvedValue({ id: groupId, tenantId }) },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new EmployeeGroupsService(prisma);

    await expect(
      service.removeMember(tenantId, groupId, employeeId, 'actor'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
