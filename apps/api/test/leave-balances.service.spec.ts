import { BadRequestException } from '@nestjs/common';
import { LeaveBalancesService } from '../src/leave-balances/leave-balances.service';
import { EmployeesService } from '../src/employees/employees.service';
import { PrismaService } from '../src/prisma/prisma.service';

const tenantId = 'de305d54-75b4-431b-adb2-eb6b9e546014';
const employeeId = '8d11d74a-e6b1-4a4c-9104-59538a65f28d';
const leaveTypeId = 'c56a4180-65aa-42ec-a945-5fd21dec0538';

describe('LeaveBalancesService.list', () => {
  it('resolves the employeeId from the subject for an EMPLOYEE caller, ignoring any query param', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { leaveBalance: { findMany } } as unknown as PrismaService;
    const employees = {
      getByCognitoSubject: jest.fn().mockResolvedValue({ id: employeeId }),
    } as unknown as EmployeesService;
    const service = new LeaveBalancesService(prisma, employees);

    await service.list(tenantId, 'actor', 'EMPLOYEE', { employeeId: 'someone-else' });

    expect(employees.getByCognitoSubject).toHaveBeenCalledWith(tenantId, 'actor');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ employeeId }) }),
    );
  });

  it('uses the query employeeId for a non-EMPLOYEE caller', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { leaveBalance: { findMany } } as unknown as PrismaService;
    const employees = { getByCognitoSubject: jest.fn() } as unknown as EmployeesService;
    const service = new LeaveBalancesService(prisma, employees);

    await service.list(tenantId, 'actor', 'HR_ADMIN', { employeeId });

    expect(employees.getByCognitoSubject).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ employeeId }) }),
    );
  });

  it('defaults to the current calendar year when none is given', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { leaveBalance: { findMany } } as unknown as PrismaService;
    const employees = { getByCognitoSubject: jest.fn() } as unknown as EmployeesService;
    const service = new LeaveBalancesService(prisma, employees);

    await service.list(tenantId, 'actor', 'HR_ADMIN', {});

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ year: new Date().getFullYear() }),
      }),
    );
  });
});

describe('LeaveBalancesService.set', () => {
  it('rejects an employeeId that does not belong to the tenant', async () => {
    const prisma = {
      employee: { count: jest.fn().mockResolvedValue(0) },
      leaveType: { count: jest.fn().mockResolvedValue(1) },
    } as unknown as PrismaService;
    const employees = {} as EmployeesService;
    const service = new LeaveBalancesService(prisma, employees);

    await expect(
      service.set(tenantId, 'actor', { employeeId, leaveTypeId, year: 2026, allocatedDays: 12 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates a new balance and logs a grant audit event when none existed', async () => {
    const upsert = jest.fn().mockResolvedValue({ id: 'balance-id', allocatedDays: { toString: () => '12' } });
    const tx = {
      leaveBalance: { findFirst: jest.fn().mockResolvedValue(null), upsert },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      employee: { count: jest.fn().mockResolvedValue(1) },
      leaveType: { count: jest.fn().mockResolvedValue(1) },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const employees = {} as EmployeesService;
    const service = new LeaveBalancesService(prisma, employees);

    await service.set(tenantId, 'actor', { employeeId, leaveTypeId, year: 2026, allocatedDays: 12 });

    expect(tx.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'leave_balance.granted' }) }),
    );
  });
});
