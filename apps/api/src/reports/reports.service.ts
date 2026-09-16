import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface DepartmentBucket {
  departmentId: string | null;
  departmentName: string;
  employeeIds: Set<string>;
  present: number;
  absent: number;
  partial: number;
  leave: number;
  holiday: number;
  weekend: number;
  onDuty: number;
  openExceptions: number;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async attendanceSummaryByDepartment(tenantId: string, periodId: string) {
    const period = await this.prisma.processingPeriod.findFirst({
      where: { id: periodId, tenantId },
    });
    if (!period) throw new NotFoundException('Processing period not found');

    const [days, openExceptions] = await this.prisma.$transaction([
      this.prisma.attendanceDay.findMany({
        where: { tenantId, periodId },
        select: {
          status: true,
          employeeId: true,
          employee: {
            select: { departmentId: true, department: { select: { name: true } } },
          },
        },
      }),
      this.prisma.attendanceException.findMany({
        where: { tenantId, status: 'OPEN', attendanceDay: { periodId } },
        select: {
          employee: { select: { departmentId: true, department: { select: { name: true } } } },
        },
      }),
    ]);

    const buckets = new Map<string, DepartmentBucket>();
    const bucketFor = (departmentId: string | null, name: string): DepartmentBucket => {
      const key = departmentId ?? 'unassigned';
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          departmentId,
          departmentName: name,
          employeeIds: new Set(),
          present: 0,
          absent: 0,
          partial: 0,
          leave: 0,
          holiday: 0,
          weekend: 0,
          onDuty: 0,
          openExceptions: 0,
        };
        buckets.set(key, bucket);
      }
      return bucket;
    };

    for (const day of days) {
      const bucket = bucketFor(
        day.employee.departmentId,
        day.employee.department?.name ?? 'Unassigned',
      );
      bucket.employeeIds.add(day.employeeId);
      switch (day.status) {
        case 'PRESENT':
          bucket.present += 1;
          break;
        case 'ABSENT':
          bucket.absent += 1;
          break;
        case 'PARTIAL':
          bucket.partial += 1;
          break;
        case 'LEAVE':
          bucket.leave += 1;
          break;
        case 'HOLIDAY':
          bucket.holiday += 1;
          break;
        case 'WEEKEND':
          bucket.weekend += 1;
          break;
        case 'ON_DUTY':
          bucket.onDuty += 1;
          break;
      }
    }
    for (const exception of openExceptions) {
      const bucket = bucketFor(
        exception.employee?.departmentId ?? null,
        exception.employee?.department?.name ?? 'Unassigned',
      );
      bucket.openExceptions += 1;
    }

    return Array.from(buckets.values())
      .map(({ employeeIds, ...bucket }) => ({
        ...bucket,
        employeeCount: employeeIds.size,
      }))
      .sort((a, b) => a.departmentName.localeCompare(b.departmentName));
  }

  async exceptionTrends(tenantId: string, periodIdsRaw: string) {
    const periodIds = Array.from(
      new Set(
        periodIdsRaw
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    );
    if (periodIds.length === 0) {
      throw new BadRequestException('At least one periodId is required');
    }
    const periods = await this.prisma.processingPeriod.findMany({
      where: { tenantId, id: { in: periodIds } },
      select: { id: true, name: true, startsOn: true },
      orderBy: { startsOn: 'asc' },
    });
    if (periods.length !== periodIds.length) {
      throw new BadRequestException('One or more periods were not found');
    }

    // Counts every exception ever raised in the period regardless of current status, since
    // most exceptions in older periods will already be resolved - the point is spotting
    // recurring patterns, not the current open queue (that's the Exception Workbench).
    const exceptions = await this.prisma.attendanceException.findMany({
      where: { tenantId, attendanceDay: { periodId: { in: periodIds } } },
      select: { type: true, severity: true, attendanceDay: { select: { periodId: true } } },
    });

    const byPeriod = new Map<
      string,
      { total: number; critical: number; high: number; byType: Record<string, number> }
    >();
    for (const period of periods) {
      byPeriod.set(period.id, { total: 0, critical: 0, high: 0, byType: {} });
    }
    for (const exception of exceptions) {
      const periodId = exception.attendanceDay?.periodId;
      const bucket = periodId ? byPeriod.get(periodId) : undefined;
      if (!bucket) continue;
      bucket.total += 1;
      if (exception.severity === 'CRITICAL') bucket.critical += 1;
      if (exception.severity === 'HIGH') bucket.high += 1;
      bucket.byType[exception.type] = (bucket.byType[exception.type] ?? 0) + 1;
    }

    return periods.map((period) => ({
      periodId: period.id,
      periodName: period.name,
      ...byPeriod.get(period.id)!,
    }));
  }

  async leaveUtilization(tenantId: string, year: number) {
    const [grouped, leaveTypes] = await this.prisma.$transaction([
      this.prisma.leaveBalance.groupBy({
        by: ['leaveTypeId'],
        where: { tenantId, year },
        orderBy: { leaveTypeId: 'asc' },
        _sum: { allocatedDays: true, usedDays: true },
        _count: true,
      }),
      this.prisma.leaveType.findMany({
        where: { tenantId },
        select: { id: true, name: true, isCompOff: true, paid: true },
      }),
    ]);
    const typeById = new Map(leaveTypes.map((type) => [type.id, type]));

    return grouped
      .map((row) => {
        const type = typeById.get(row.leaveTypeId);
        const allocated = row._sum?.allocatedDays ?? new Prisma.Decimal(0);
        const used = row._sum?.usedDays ?? new Prisma.Decimal(0);
        return {
          leaveTypeId: row.leaveTypeId,
          name: type?.name ?? 'Unknown',
          isCompOff: type?.isCompOff ?? false,
          paid: type?.paid ?? true,
          employeeCount: row._count,
          allocatedDays: allocated.toString(),
          usedDays: used.toString(),
          remainingDays: allocated.minus(used).toString(),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
