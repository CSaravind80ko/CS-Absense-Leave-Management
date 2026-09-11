import { AuditEventsService } from '../src/audit-events/audit-events.service';
import { PrismaService } from '../src/prisma/prisma.service';

const tenantId = 'de305d54-75b4-431b-adb2-eb6b9e546014';
const entityId = 'c56a4180-65aa-42ec-a945-5fd21dec0538';

describe('AuditEventsService.list', () => {
  it('scopes to the tenant and applies entityType/entityId/actorSubject filters', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = {
      auditEvent: { findMany, count },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    } as unknown as PrismaService;
    const service = new AuditEventsService(prisma);

    await service.list(tenantId, {
      page: 1,
      pageSize: 25,
      order: 'desc',
      entityType: 'Holiday',
      entityId,
      actorSubject: 'actor-1',
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId,
          entityType: 'Holiday',
          entityId,
          actorSubject: 'actor-1',
          occurredAt: undefined,
        },
      }),
    );
  });

  it('builds an inclusive occurredAt range from dateFrom/dateTo', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      auditEvent: { findMany, count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    } as unknown as PrismaService;
    const service = new AuditEventsService(prisma);

    await service.list(tenantId, {
      page: 1,
      pageSize: 25,
      order: 'desc',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-10',
    });

    const [[callArgs]] = findMany.mock.calls;
    expect(callArgs.where.occurredAt.gte).toEqual(new Date('2026-09-01'));
    expect(callArgs.where.occurredAt.lte).toEqual(new Date('2026-09-10T23:59:59.999Z'));
  });

  it('paginates and orders by occurredAt', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      auditEvent: { findMany, count: jest.fn().mockResolvedValue(90) },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    } as unknown as PrismaService;
    const service = new AuditEventsService(prisma);

    const result = await service.list(tenantId, { page: 2, pageSize: 30, order: 'asc' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { occurredAt: 'asc' }, skip: 30, take: 30 }),
    );
    expect(result.totalPages).toBe(3);
  });
});

describe('AuditEventsService.listEntityTypes', () => {
  it('returns the distinct entityType values scoped to the tenant', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { entityType: 'Holiday' },
      { entityType: 'PolicyVersion' },
    ]);
    const prisma = { auditEvent: { findMany } } as unknown as PrismaService;
    const service = new AuditEventsService(prisma);

    const result = await service.listEntityTypes(tenantId);

    expect(result).toEqual(['Holiday', 'PolicyVersion']);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId }, distinct: ['entityType'] }),
    );
  });
});
