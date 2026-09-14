import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { OnDutyRequestsService } from '../src/on-duty-requests/on-duty-requests.service';
import { EmployeesService } from '../src/employees/employees.service';
import { PrismaService } from '../src/prisma/prisma.service';

const tenantId = 'de305d54-75b4-431b-adb2-eb6b9e546014';
const employeeId = '8d11d74a-e6b1-4a4c-9104-59538a65f28d';

function employees(id = employeeId) {
  return { getByCognitoSubject: jest.fn().mockResolvedValue({ id }) } as unknown as EmployeesService;
}

describe('OnDutyRequestsService.submit', () => {
  it('rejects startDate after endDate', async () => {
    const prisma = {} as unknown as PrismaService;
    const service = new OnDutyRequestsService(prisma, employees());

    await expect(
      service.submit(tenantId, 'actor', {
        category: 'CLIENT_VISIT', startDate: '2026-09-22', endDate: '2026-09-20', reason: 'Client site visit',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a halfDay request spanning more than one date', async () => {
    const prisma = {} as unknown as PrismaService;
    const service = new OnDutyRequestsService(prisma, employees());

    await expect(
      service.submit(tenantId, 'actor', {
        category: 'CLIENT_VISIT', startDate: '2026-09-20', endDate: '2026-09-21', halfDay: true, reason: 'Visit',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an overlapping pending/approved on-duty request', async () => {
    const prisma = {
      onDutyRequest: { count: jest.fn().mockResolvedValue(1) },
      leaveRequest: { count: jest.fn().mockResolvedValue(0) },
    } as unknown as PrismaService;
    const service = new OnDutyRequestsService(prisma, employees());

    await expect(
      service.submit(tenantId, 'actor', {
        category: 'CLIENT_VISIT', startDate: '2026-09-20', endDate: '2026-09-20', reason: 'Visit',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an overlapping pending/approved leave request', async () => {
    const prisma = {
      onDutyRequest: { count: jest.fn().mockResolvedValue(0) },
      leaveRequest: { count: jest.fn().mockResolvedValue(1) },
    } as unknown as PrismaService;
    const service = new OnDutyRequestsService(prisma, employees());

    await expect(
      service.submit(tenantId, 'actor', {
        category: 'CLIENT_VISIT', startDate: '2026-09-20', endDate: '2026-09-20', reason: 'Visit',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('computes totalDays as 0.5 for a halfDay request', async () => {
    const requestCreate = jest.fn().mockResolvedValue({ id: 'req-id', totalDays: { toString: () => '0.5' } });
    const tx = {
      onDutyRequest: { create: requestCreate },
      approvalRequest: { create: jest.fn().mockResolvedValue({ id: 'approval-id' }) },
      approvalAction: { create: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      onDutyRequest: { count: jest.fn().mockResolvedValue(0) },
      leaveRequest: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new OnDutyRequestsService(prisma, employees());

    await service.submit(tenantId, 'actor', {
      category: 'CLIENT_VISIT', startDate: '2026-09-20', endDate: '2026-09-20', halfDay: true, reason: 'Visit',
    });

    expect(requestCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ totalDays: 0.5, halfDay: true }) }),
    );
  });

  it('creates the OnDutyRequest and a routing ApprovalRequest assigned to MANAGER together', async () => {
    const approvalCreate = jest.fn().mockResolvedValue({ id: 'approval-id' });
    const tx = {
      onDutyRequest: { create: jest.fn().mockResolvedValue({ id: 'req-id', totalDays: { toString: () => '1' } }) },
      approvalRequest: { create: approvalCreate },
      approvalAction: { create: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      onDutyRequest: { count: jest.fn().mockResolvedValue(0) },
      leaveRequest: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new OnDutyRequestsService(prisma, employees());

    await service.submit(tenantId, 'actor', {
      category: 'GOVERNMENT_OFFICE', startDate: '2026-09-20', endDate: '2026-09-20', reason: 'Filing paperwork',
    });

    expect(approvalCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId,
          type: 'ON_DUTY',
          onDutyRequestId: 'req-id',
          requestedBy: 'actor',
          assigneeRole: 'MANAGER',
        }),
      }),
    );
  });
});

describe('OnDutyRequestsService.list', () => {
  it("forces the employeeId to the caller's own for an EMPLOYEE, ignoring the query param", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
      onDutyRequest: { findMany, count: jest.fn().mockResolvedValue(0) },
    } as unknown as PrismaService;
    const service = new OnDutyRequestsService(prisma, employees());

    await service.list(tenantId, 'actor', 'EMPLOYEE', {
      page: 1, pageSize: 25, order: 'desc', employeeId: 'someone-else',
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ employeeId }) }),
    );
  });
});

describe('OnDutyRequestsService.get', () => {
  it("hides another employee's request from an EMPLOYEE caller as NotFoundException", async () => {
    const prisma = {
      onDutyRequest: {
        findFirst: jest.fn().mockResolvedValue({ id: 'req-id', tenantId, employeeId: 'other-employee' }),
      },
    } as unknown as PrismaService;
    const service = new OnDutyRequestsService(prisma, employees());

    await expect(
      service.get(tenantId, 'actor', 'EMPLOYEE', 'req-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
