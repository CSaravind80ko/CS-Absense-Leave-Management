import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ApplicationRole } from '@prisma/client';
import 'reflect-metadata';
import { ApprovalsController } from '../src/approvals/approvals.controller';
import { ApprovalsService } from '../src/approvals/approvals.service';
import { AttendanceController } from '../src/attendance/attendance.controller';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { ExceptionsController } from '../src/exceptions/exceptions.controller';
import { ExceptionsService } from '../src/exceptions/exceptions.service';
import { PayrollController } from '../src/payroll/payroll.controller';
import { PayrollService } from '../src/payroll/payroll.service';
import { PrismaService } from '../src/prisma/prisma.service';

const tenantId = 'de305d54-75b4-431b-adb2-eb6b9e546014';
const periodId = 'c56a4180-65aa-42ec-a945-5fd21dec0538';
const entityId = '8d11d74a-e6b1-4a4c-9104-59538a65f28d';

const transaction = (tx: object) =>
  jest.fn((operation: (client: object) => unknown) => operation(tx));

describe('Live attendance workflow authorization', () => {
  it('keeps operational read APIs role-scoped', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AttendanceController)).toEqual(
      expect.arrayContaining([
        ApplicationRole.HR_ADMIN,
        ApplicationRole.PAYROLL_ADMIN,
        ApplicationRole.AUDITOR,
      ]),
    );
    expect(Reflect.getMetadata(ROLES_KEY, ExceptionsController)).not.toContain(
      ApplicationRole.EMPLOYEE,
    );
    expect(Reflect.getMetadata(ROLES_KEY, ApprovalsController)).toContain(
      ApplicationRole.MANAGER,
    );
    expect(Reflect.getMetadata(ROLES_KEY, PayrollController)).not.toContain(
      ApplicationRole.MANAGER,
    );
  });
});

describe('ExceptionsService', () => {
  const existing = {
    id: entityId,
    tenantId,
    status: 'OPEN',
    severity: 'CRITICAL',
    payrollImpact: 'BLOCKED',
    assignedToSubject: null,
    assignedToRole: 'HR_ADMIN',
    version: 4,
  };

  it('uses tenant and version in a decision and appends an audit event', async () => {
    const decided = { ...existing, status: 'RESOLVED', version: 5 };
    const tx = {
      attendanceException: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: jest.fn().mockResolvedValue(decided),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      attendanceException: { findFirst: jest.fn().mockResolvedValue(existing) },
      $transaction: transaction(tx),
    } as unknown as PrismaService;

    const result = await new ExceptionsService(prisma).decide(
      tenantId,
      entityId,
      'hr-subject',
      { decision: 'RESOLVED', note: 'Validated source evidence', version: 4 },
    );

    expect(result).toEqual(decided);
    expect(tx.attendanceException.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: entityId, tenantId, status: 'OPEN', version: 4 },
      }),
    );
    expect(tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId,
        action: 'exception.resolved',
        entityId,
      }),
    });
  });

  it('returns conflict when another HR action won the race', async () => {
    const tx = {
      attendanceException: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma = {
      attendanceException: { findFirst: jest.fn().mockResolvedValue(existing) },
      $transaction: transaction(tx),
    } as unknown as PrismaService;

    await expect(
      new ExceptionsService(prisma).decide(
        tenantId,
        entityId,
        'hr-subject',
        { decision: 'DISMISSED', note: 'Duplicate source record', version: 3 },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not resolve an ID outside the tenant', async () => {
    const prisma = {
      attendanceException: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    await expect(
      new ExceptionsService(prisma).decide(
        tenantId,
        entityId,
        'hr-subject',
        { decision: 'RESOLVED', note: 'Validated evidence', version: 1 },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ApprovalsService', () => {
  const request = {
    id: entityId,
    tenantId,
    type: 'EXCEPTION',
    status: 'PENDING',
    periodId: null,
    exceptionId: entityId,
    requestedBy: 'employee-subject',
    assigneeSubject: null,
    assigneeRole: 'MANAGER',
    currentStep: 1,
    version: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as const;

  it('appends approval history and updates status atomically', async () => {
    const approved = { ...request, status: 'APPROVED', version: 3 };
    const tx = {
      approvalRequest: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: jest.fn().mockResolvedValue(approved),
      },
      approvalAction: { create: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      approvalRequest: { findFirst: jest.fn().mockResolvedValue(request) },
      $transaction: transaction(tx),
    } as unknown as PrismaService;

    const result = await new ApprovalsService(prisma).act(
      tenantId,
      entityId,
      'manager-subject',
      'MANAGER',
      { action: 'APPROVED', version: 2, comment: 'Evidence confirmed' },
    );

    expect(result).toEqual(approved);
    expect(tx.approvalAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId,
        approvalRequestId: entityId,
        action: 'APPROVED',
      }),
    });
  });

  it('rejects action by a role not assigned to the request', async () => {
    const prisma = {
      approvalRequest: { findFirst: jest.fn().mockResolvedValue(request) },
    } as unknown as PrismaService;

    await expect(
      new ApprovalsService(prisma).act(
        tenantId,
        entityId,
        'payroll-subject',
        'PAYROLL_ADMIN',
        { action: 'APPROVED', version: 2 },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires a reason when rejecting', async () => {
    const prisma = {} as PrismaService;
    await expect(
      new ApprovalsService(prisma).act(
        tenantId,
        entityId,
        'manager-subject',
        'MANAGER',
        { action: 'REJECTED', version: 2 },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PayrollService', () => {
  const approvedPeriod = {
    id: periodId,
    tenantId,
    status: 'APPROVED',
    version: 7,
  };

  it('blocks export requests while critical exceptions are unresolved', async () => {
    const tx = {
      processingPeriod: {
        findFirst: jest.fn().mockResolvedValue(approvedPeriod),
      },
      attendanceException: { count: jest.fn().mockResolvedValue(2) },
    };
    const prisma = {
      $transaction: transaction(tx),
    } as unknown as PrismaService;
    await expect(
      new PayrollService(prisma).create(tenantId, 'payroll-subject', {
        periodId,
        periodVersion: 7,
        format: 'XLSX',
      }),
    ).rejects.toThrow('prevent payroll export');
  });

  it('returns an exact metadata-only worker dispatch contract', async () => {
    const createdAt = new Date('2026-08-28T08:00:00.000Z');
    const payrollExport = {
      id: entityId,
      tenantId,
      periodId,
      format: 'CSV',
      status: 'DRAFT',
      requestedBy: 'payroll-subject',
      createdAt,
    };
    const tx = {
      processingPeriod: {
        findFirst: jest.fn().mockResolvedValue(approvedPeriod),
      },
      attendanceException: { count: jest.fn().mockResolvedValue(0) },
      attendanceDay: { count: jest.fn().mockResolvedValue(20) },
      payrollExport: { create: jest.fn().mockResolvedValue(payrollExport) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: transaction(tx),
    } as unknown as PrismaService;

    const result = await new PayrollService(prisma).create(
      tenantId,
      'payroll-subject',
      { periodId, periodVersion: 7, format: 'CSV' },
    );

    expect(result.workerConnected).toBe(false);
    expect(tx.payrollExport.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ periodVersion: 7 }),
    });
    expect(result.dispatch).toEqual({
      eventType: 'payroll.export.requested.v1',
      payload: {
        tenantId,
        periodId,
        periodVersion: 7,
        payrollExportId: entityId,
        format: 'CSV',
        requestedBy: 'payroll-subject',
        requestedAt: '2026-08-28T08:00:00.000Z',
      },
    });
  });

  it('rejects a stale period version before creating an export', async () => {
    const tx = {
      processingPeriod: {
        findFirst: jest.fn().mockResolvedValue(approvedPeriod),
      },
    };
    const prisma = {
      $transaction: transaction(tx),
    } as unknown as PrismaService;
    await expect(
      new PayrollService(prisma).create(tenantId, 'payroll-subject', {
        periodId,
        periodVersion: 6,
        format: 'CSV',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
