import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AttendanceSourceConnectionsService } from '../src/attendance-source-connections/attendance-source-connections.service';
import { PrismaService } from '../src/prisma/prisma.service';

const tenantId = 'de305d54-75b4-431b-adb2-eb6b9e546014';
const connectionId = 'c56a4180-65aa-42ec-a945-5fd21dec0538';

describe('AttendanceSourceConnectionsService.create', () => {
  it('rejects a duplicate connection name within the tenant', async () => {
    const tx = { attendanceSourceConnection: { count: jest.fn().mockResolvedValue(1) } };
    const prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new AttendanceSourceConnectionsService(prisma);

    await expect(
      service.create(tenantId, 'actor', { type: 'ESSL_BIOMETRIC', name: 'HQ biometric' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates a DRAFT connection and records an audit event', async () => {
    const createFn = jest.fn().mockResolvedValue({ id: connectionId, status: 'DRAFT' });
    const auditCreate = jest.fn().mockResolvedValue({});
    const tx = {
      attendanceSourceConnection: { count: jest.fn().mockResolvedValue(0), create: createFn },
      auditEvent: { create: auditCreate },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new AttendanceSourceConnectionsService(prisma);

    await service.create(tenantId, 'actor', {
      type: 'GREYTHR',
      name: 'greytHR primary',
      config: { baseUrl: 'https://example.com' },
    });

    expect(createFn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId, type: 'GREYTHR', name: 'greytHR primary' }),
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'attendance_source_connection.created' }),
      }),
    );
  });
});

describe('AttendanceSourceConnectionsService.updateStatus', () => {
  it('does not reveal a connection belonging to another tenant', async () => {
    const prisma = {
      attendanceSourceConnection: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new AttendanceSourceConnectionsService(prisma);

    await expect(
      service.updateStatus(tenantId, 'actor', connectionId, { status: 'READY' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects an invalid status transition', async () => {
    const prisma = {
      attendanceSourceConnection: {
        findFirst: jest.fn().mockResolvedValue({
          id: connectionId,
          tenantId,
          status: 'DRAFT',
          config: { host: 'sftp.example.com' },
        }),
      },
    } as unknown as PrismaService;
    const service = new AttendanceSourceConnectionsService(prisma);

    await expect(
      service.updateStatus(tenantId, 'actor', connectionId, { status: 'ACTIVE' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires config to be set before moving to READY', async () => {
    const prisma = {
      attendanceSourceConnection: {
        findFirst: jest.fn().mockResolvedValue({
          id: connectionId,
          tenantId,
          status: 'DRAFT',
          config: null,
        }),
      },
    } as unknown as PrismaService;
    const service = new AttendanceSourceConnectionsService(prisma);

    await expect(
      service.updateStatus(tenantId, 'actor', connectionId, { status: 'READY' }),
    ).rejects.toThrow('config must be set');
  });

  it('marks activatedAt when transitioning to ACTIVE', async () => {
    const updateFn = jest.fn().mockResolvedValue({ id: connectionId, status: 'ACTIVE' });
    const tx = {
      attendanceSourceConnection: { update: updateFn },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      attendanceSourceConnection: {
        findFirst: jest.fn().mockResolvedValue({
          id: connectionId,
          tenantId,
          status: 'READY',
          config: { host: 'sftp.example.com' },
          activatedAt: null,
        }),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new AttendanceSourceConnectionsService(prisma);

    await service.updateStatus(tenantId, 'actor', connectionId, { status: 'ACTIVE' });

    expect(updateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ACTIVE', activatedAt: expect.any(Date) }),
      }),
    );
  });
});

describe('AttendanceSourceConnectionsService.recordSyncLog', () => {
  it('creates a sync log and updates the connection last-sync fields', async () => {
    const logCreate = jest
      .fn()
      .mockResolvedValue({ id: 'log-id', occurredAt: new Date('2026-09-15T00:00:00.000Z') });
    const connectionUpdate = jest.fn().mockResolvedValue({});
    const tx = {
      attendanceSourceSyncLog: { create: logCreate },
      attendanceSourceConnection: { update: connectionUpdate },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      attendanceSourceConnection: {
        findFirst: jest.fn().mockResolvedValue({ id: connectionId, tenantId, status: 'ACTIVE' }),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new AttendanceSourceConnectionsService(prisma);

    await service.recordSyncLog(tenantId, 'actor', connectionId, {
      status: 'SUCCESS',
      recordCount: 3684,
    });

    expect(connectionUpdate).toHaveBeenCalledWith({
      where: { id: connectionId },
      data: {
        lastSyncAt: new Date('2026-09-15T00:00:00.000Z'),
        lastSyncStatus: 'SUCCESS',
        lastSyncRecordCount: 3684,
      },
    });
  });
});
