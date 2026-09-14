import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { LeaveRequestsService } from '../src/leave-requests/leave-requests.service';
import { EmployeesService } from '../src/employees/employees.service';
import { PrismaService } from '../src/prisma/prisma.service';

const tenantId = 'de305d54-75b4-431b-adb2-eb6b9e546014';
const employeeId = '8d11d74a-e6b1-4a4c-9104-59538a65f28d';
const leaveTypeId = 'c56a4180-65aa-42ec-a945-5fd21dec0538';

function employees(id = employeeId) {
  return { getByCognitoSubject: jest.fn().mockResolvedValue({ id }) } as unknown as EmployeesService;
}

describe('LeaveRequestsService.submit', () => {
  it('rejects a leaveTypeId that does not exist or is inactive', async () => {
    const prisma = {
      leaveType: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new LeaveRequestsService(prisma, employees());

    await expect(
      service.submit(tenantId, 'actor', { leaveTypeId, startDate: '2026-09-20', endDate: '2026-09-20' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects startDate after endDate', async () => {
    const prisma = {
      leaveType: { findFirst: jest.fn().mockResolvedValue({ id: leaveTypeId, paid: true, name: 'Casual' }) },
    } as unknown as PrismaService;
    const service = new LeaveRequestsService(prisma, employees());

    await expect(
      service.submit(tenantId, 'actor', { leaveTypeId, startDate: '2026-09-22', endDate: '2026-09-20' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a halfDay request spanning more than one date', async () => {
    const prisma = {
      leaveType: { findFirst: jest.fn().mockResolvedValue({ id: leaveTypeId, paid: true, name: 'Casual' }) },
    } as unknown as PrismaService;
    const service = new LeaveRequestsService(prisma, employees());

    await expect(
      service.submit(tenantId, 'actor', {
        leaveTypeId, startDate: '2026-09-20', endDate: '2026-09-21', halfDay: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an overlapping pending/approved leave request', async () => {
    const prisma = {
      leaveType: { findFirst: jest.fn().mockResolvedValue({ id: leaveTypeId, paid: true, name: 'Casual' }) },
      leaveRequest: { count: jest.fn().mockResolvedValue(1) },
    } as unknown as PrismaService;
    const service = new LeaveRequestsService(prisma, employees());

    await expect(
      service.submit(tenantId, 'actor', { leaveTypeId, startDate: '2026-09-20', endDate: '2026-09-20' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a paid leave type request that exceeds the available balance', async () => {
    const prisma = {
      leaveType: { findFirst: jest.fn().mockResolvedValue({ id: leaveTypeId, paid: true, name: 'Casual' }) },
      leaveRequest: { count: jest.fn().mockResolvedValue(0) },
      leaveBalance: {
        findFirst: jest.fn().mockResolvedValue({
          allocatedDays: { minus: () => ({ toNumber: () => 1 }) },
        }),
      },
    } as unknown as PrismaService;
    const service = new LeaveRequestsService(prisma, employees());

    await expect(
      service.submit(tenantId, 'actor', { leaveTypeId, startDate: '2026-09-20', endDate: '2026-09-22' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('skips the balance check entirely for an unpaid leave type', async () => {
    const requestCreate = jest.fn().mockResolvedValue({ id: 'req-id', totalDays: { toString: () => '1' } });
    const tx = {
      leaveRequest: { create: requestCreate },
      approvalRequest: { create: jest.fn().mockResolvedValue({ id: 'approval-id' }) },
      approvalAction: { create: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const balanceFindFirst = jest.fn();
    const prisma = {
      leaveType: { findFirst: jest.fn().mockResolvedValue({ id: leaveTypeId, paid: false, name: 'Unpaid' }) },
      leaveRequest: { count: jest.fn().mockResolvedValue(0) },
      leaveBalance: { findFirst: balanceFindFirst },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new LeaveRequestsService(prisma, employees());

    await service.submit(tenantId, 'actor', { leaveTypeId, startDate: '2026-09-20', endDate: '2026-09-20' });

    expect(balanceFindFirst).not.toHaveBeenCalled();
    expect(requestCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ totalDays: 1 }) }),
    );
  });

  it('computes totalDays as 0.5 for a halfDay request', async () => {
    const requestCreate = jest.fn().mockResolvedValue({ id: 'req-id', totalDays: { toString: () => '0.5' } });
    const tx = {
      leaveRequest: { create: requestCreate },
      approvalRequest: { create: jest.fn().mockResolvedValue({ id: 'approval-id' }) },
      approvalAction: { create: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      leaveType: { findFirst: jest.fn().mockResolvedValue({ id: leaveTypeId, paid: false, name: 'Unpaid' }) },
      leaveRequest: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new LeaveRequestsService(prisma, employees());

    await service.submit(tenantId, 'actor', {
      leaveTypeId, startDate: '2026-09-20', endDate: '2026-09-20', halfDay: true,
    });

    expect(requestCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ totalDays: 0.5, halfDay: true }) }),
    );
  });

  it('creates the LeaveRequest and a routing ApprovalRequest assigned to MANAGER together', async () => {
    const approvalCreate = jest.fn().mockResolvedValue({ id: 'approval-id' });
    const tx = {
      leaveRequest: { create: jest.fn().mockResolvedValue({ id: 'req-id', totalDays: { toString: () => '1' } }) },
      approvalRequest: { create: approvalCreate },
      approvalAction: { create: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      leaveType: { findFirst: jest.fn().mockResolvedValue({ id: leaveTypeId, paid: false, name: 'Unpaid' }) },
      leaveRequest: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new LeaveRequestsService(prisma, employees());

    await service.submit(tenantId, 'actor', { leaveTypeId, startDate: '2026-09-20', endDate: '2026-09-20' });

    expect(approvalCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId,
          type: 'LEAVE',
          leaveRequestId: 'req-id',
          requestedBy: 'actor',
          assigneeRole: 'MANAGER',
        }),
      }),
    );
  });
});

describe('LeaveRequestsService.list', () => {
  it('forces the employeeId to the caller\'s own for an EMPLOYEE, ignoring the query param', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
      leaveRequest: { findMany, count: jest.fn().mockResolvedValue(0) },
    } as unknown as PrismaService;
    const service = new LeaveRequestsService(prisma, employees());

    await service.list(tenantId, 'actor', 'EMPLOYEE', {
      page: 1, pageSize: 25, order: 'desc', employeeId: 'someone-else',
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ employeeId }) }),
    );
  });
});

describe('LeaveRequestsService.get', () => {
  it('hides another employee\'s request from an EMPLOYEE caller as NotFoundException', async () => {
    const prisma = {
      leaveRequest: {
        findFirst: jest.fn().mockResolvedValue({ id: 'req-id', tenantId, employeeId: 'other-employee' }),
      },
    } as unknown as PrismaService;
    const service = new LeaveRequestsService(prisma, employees());

    await expect(
      service.get(tenantId, 'actor', 'EMPLOYEE', 'req-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
