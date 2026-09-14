import { ApprovalsService } from '../src/approvals/approvals.service';
import { PrismaService } from '../src/prisma/prisma.service';

const tenantId = 'de305d54-75b4-431b-adb2-eb6b9e546014';
const approvalId = 'c56a4180-65aa-42ec-a945-5fd21dec0538';
const leaveRequestId = '8d11d74a-e6b1-4a4c-9104-59538a65f28d';
const employeeId = '11111111-1111-4111-8111-111111111111';

function pendingLeaveApproval(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: approvalId,
    tenantId,
    type: 'LEAVE',
    status: 'PENDING',
    version: 1,
    leaveRequestId,
    requestedBy: 'employee-subject',
    assigneeSubject: null,
    assigneeRole: 'MANAGER',
    ...overrides,
  };
}

describe('ApprovalsService.list — periodId filter does not exclude LEAVE', () => {
  it('includes LEAVE in the OR clause alongside period-matched and exception-matched requests', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
      approvalRequest: { findMany, count: jest.fn().mockResolvedValue(0) },
    } as unknown as PrismaService;
    const service = new ApprovalsService(prisma);

    await service.list(tenantId, 'manager-subject', 'MANAGER', {
      page: 1, pageSize: 25, order: 'desc', sortBy: 'createdAt', scope: 'inbox', periodId: 'period-1',
    });

    const [[callArgs]] = findMany.mock.calls;
    expect(callArgs.where.AND[1].OR).toContainEqual({ type: 'LEAVE' });
  });
});

describe('ApprovalsService.act — LEAVE integration', () => {
  it('approving updates LeaveRequest.status, deducts the balance, and enqueues a recompute', async () => {
    const leaveRequest = {
      id: leaveRequestId,
      tenantId,
      employeeId,
      leaveTypeId: 'leave-type-id',
      startDate: new Date('2026-09-20'),
      endDate: new Date('2026-09-20'),
      totalDays: { greaterThan: () => true },
    };
    const balance = {
      id: 'balance-id',
      allocatedDays: { minus: () => ({ lessThan: () => false }) },
    };
    const leaveRequestUpdate = jest.fn().mockResolvedValue({});
    const balanceUpdate = jest.fn().mockResolvedValue({});
    const recomputeJobCreate = jest.fn().mockResolvedValue({ id: 'recompute-job-id' });
    const tx = {
      approvalRequest: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: jest.fn().mockResolvedValue({ id: approvalId, status: 'APPROVED' }),
      },
      approvalAction: { create: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
      leaveRequest: {
        findFirstOrThrow: jest.fn().mockResolvedValue(leaveRequest),
        update: leaveRequestUpdate,
      },
      leaveBalance: {
        findFirst: jest.fn().mockResolvedValue(balance),
        update: balanceUpdate,
      },
      policyRecomputeJob: { create: recomputeJobCreate },
      outboxEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      approvalRequest: { findFirst: jest.fn().mockResolvedValue(pendingLeaveApproval()) },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new ApprovalsService(prisma);

    await service.act(tenantId, approvalId, 'manager-subject', 'MANAGER', {
      action: 'APPROVED',
      version: 1,
    });

    expect(leaveRequestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED' }) }),
    );
    expect(balanceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'balance-id' },
        data: { usedDays: { increment: leaveRequest.totalDays } },
      }),
    );
    expect(recomputeJobCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId,
          scopeType: 'EMPLOYEE',
          scopeId: employeeId,
          reason: 'LEAVE_APPROVED',
        }),
      }),
    );
  });

  it('throws when approving would exceed the remaining balance', async () => {
    const leaveRequest = {
      id: leaveRequestId,
      tenantId,
      employeeId,
      leaveTypeId: 'leave-type-id',
      startDate: new Date('2026-09-20'),
      endDate: new Date('2026-09-20'),
      totalDays: { greaterThan: () => true },
    };
    const balance = {
      id: 'balance-id',
      allocatedDays: { minus: () => ({ lessThan: () => true }) },
    };
    const tx = {
      approvalRequest: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      approvalAction: { create: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
      leaveRequest: {
        findFirstOrThrow: jest.fn().mockResolvedValue(leaveRequest),
        update: jest.fn().mockResolvedValue({}),
      },
      leaveBalance: { findFirst: jest.fn().mockResolvedValue(balance) },
    };
    const prisma = {
      approvalRequest: { findFirst: jest.fn().mockResolvedValue(pendingLeaveApproval()) },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new ApprovalsService(prisma);

    await expect(
      service.act(tenantId, approvalId, 'manager-subject', 'MANAGER', {
        action: 'APPROVED',
        version: 1,
      }),
    ).rejects.toThrow('Insufficient leave balance remaining to approve this request');
  });

  it('rejecting updates LeaveRequest.status without touching any balance or recompute job', async () => {
    const leaveRequestUpdate = jest.fn().mockResolvedValue({});
    const balanceFindFirst = jest.fn();
    const recomputeJobCreate = jest.fn();
    const tx = {
      approvalRequest: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: jest.fn().mockResolvedValue({ id: approvalId, status: 'REJECTED' }),
      },
      approvalAction: { create: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
      leaveRequest: {
        findFirstOrThrow: jest.fn().mockResolvedValue({
          id: leaveRequestId, tenantId, employeeId, leaveTypeId: 'leave-type-id',
          startDate: new Date('2026-09-20'), endDate: new Date('2026-09-20'),
        }),
        update: leaveRequestUpdate,
      },
      leaveBalance: { findFirst: balanceFindFirst },
      policyRecomputeJob: { create: recomputeJobCreate },
    };
    const prisma = {
      approvalRequest: { findFirst: jest.fn().mockResolvedValue(pendingLeaveApproval()) },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new ApprovalsService(prisma);

    await service.act(tenantId, approvalId, 'manager-subject', 'MANAGER', {
      action: 'REJECTED',
      version: 1,
      comment: 'Not enough coverage that week',
    });

    expect(leaveRequestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }),
    );
    expect(balanceFindFirst).not.toHaveBeenCalled();
    expect(recomputeJobCreate).not.toHaveBeenCalled();
  });

  it('leaves non-LEAVE approvals untouched by the leave side effect', async () => {
    const tx = {
      approvalRequest: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: jest.fn().mockResolvedValue({ id: approvalId, status: 'APPROVED' }),
      },
      approvalAction: { create: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
      leaveRequest: { findFirstOrThrow: jest.fn() },
    };
    const prisma = {
      approvalRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: approvalId, tenantId, type: 'EXCEPTION', status: 'PENDING', version: 1,
          leaveRequestId: null, requestedBy: 'someone', assigneeSubject: null, assigneeRole: 'MANAGER',
        }),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new ApprovalsService(prisma);

    await service.act(tenantId, approvalId, 'manager-subject', 'MANAGER', {
      action: 'APPROVED',
      version: 1,
    });

    expect(tx.leaveRequest.findFirstOrThrow).not.toHaveBeenCalled();
  });
});
