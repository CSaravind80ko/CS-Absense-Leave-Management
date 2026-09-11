import { Injectable } from '@nestjs/common';
import { AuditEvent, Prisma } from '@prisma/client';
import { PageResult, pageResult } from '../common/dto/page-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditEventQueryDto } from './dto/audit-event-query.dto';

// Read-only surface for AuditEvent: every module in this API already writes these rows
// (policy.published, holiday.created, shift.updated, employee_group.member_added, ...) but
// until now nothing let anyone browse them as a general trail.
@Injectable()
export class AuditEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, query: AuditEventQueryDto): Promise<PageResult<AuditEvent>> {
    const occurredAt =
      query.dateFrom || query.dateTo
        ? {
            gte: query.dateFrom ? new Date(query.dateFrom) : undefined,
            lte: query.dateTo ? new Date(`${query.dateTo}T23:59:59.999Z`) : undefined,
          }
        : undefined;
    const where: Prisma.AuditEventWhereInput = {
      tenantId,
      entityType: query.entityType,
      entityId: query.entityId,
      actorSubject: query.actorSubject,
      occurredAt,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { occurredAt: query.order },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.auditEvent.count({ where }),
    ]);
    return pageResult(items, total, query);
  }

  // Feeds the entity-type filter dropdown with real values instead of a hardcoded list that
  // would drift as new modules start writing their own audit actions.
  async listEntityTypes(tenantId: string): Promise<string[]> {
    const rows = await this.prisma.auditEvent.findMany({
      where: { tenantId },
      distinct: ['entityType'],
      select: { entityType: true },
      orderBy: { entityType: 'asc' },
    });
    return rows.map((row) => row.entityType);
  }
}
