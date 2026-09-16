import { ExceptionType, PrismaClient } from '@prisma/client';
import { log } from './logger';

const PATTERN_TYPES: readonly ExceptionType[] = [
  'LATE_ARRIVAL',
  'EARLY_DEPARTURE',
  'OUT_OF_LOCATION',
];

const WINDOW_DAYS = Number(process.env.ANOMALY_PATTERN_WINDOW_DAYS ?? 14);
const THRESHOLD = Number(process.env.ANOMALY_PATTERN_THRESHOLD ?? 4);

interface Bucket {
  tenantId: string;
  employeeId: string;
  type: ExceptionType;
  count: number;
}

/**
 * Single-day rules (recomputeDay) already raise LATE_ARRIVAL/EARLY_DEPARTURE/OUT_OF_LOCATION
 * one day at a time; this looks across days for the same employee+type recurring often enough
 * within a rolling window to be a pattern worth a manager's attention, and raises one
 * RECURRING_PATTERN exception for it (not one per day). dedupeKey is scoped to the current
 * month so a pattern that recurs in a later month raises again even if last month's exception
 * was resolved - re-sweeps within the same month just refresh an existing OPEN one's count and
 * leave an already-resolved one alone (a human already handled it).
 */
export class AnomalyDetectionService {
  constructor(private readonly prisma: PrismaClient) {}

  async sweep(): Promise<number> {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - WINDOW_DAYS);
    cutoff.setUTCHours(0, 0, 0, 0);

    const rows = await this.prisma.attendanceException.findMany({
      where: {
        type: { in: PATTERN_TYPES as ExceptionType[] },
        attendanceDay: { workDate: { gte: cutoff } },
      },
      select: { tenantId: true, employeeId: true, type: true },
    });

    const buckets = new Map<string, Bucket>();
    for (const row of rows) {
      if (!row.employeeId) continue;
      const key = `${row.tenantId}:${row.employeeId}:${row.type}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.count += 1;
      else buckets.set(key, { tenantId: row.tenantId, employeeId: row.employeeId, type: row.type, count: 1 });
    }

    const monthKey = new Date().toISOString().slice(0, 7);
    let flagged = 0;
    for (const bucket of buckets.values()) {
      if (bucket.count < THRESHOLD) continue;
      try {
        const raised = await this.raise(bucket, monthKey);
        if (raised) flagged += 1;
      } catch (error) {
        log('error', 'anomaly pattern sweep failed for employee', {
          tenantId: bucket.tenantId,
          employeeId: bucket.employeeId,
          patternType: bucket.type,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return flagged;
  }

  private async raise(bucket: Bucket, monthKey: string): Promise<boolean> {
    const dedupeKey = `anomaly:${bucket.employeeId}:${bucket.type}:${monthKey}`;
    const details = {
      patternType: bucket.type,
      occurrenceCount: bucket.count,
      windowDays: WINDOW_DAYS,
    };
    const existing = await this.prisma.attendanceException.findFirst({
      where: { tenantId: bucket.tenantId, dedupeKey },
    });
    if (existing) {
      if (existing.status !== 'OPEN') return false;
      await this.prisma.attendanceException.update({
        where: { id: existing.id },
        data: { details },
      });
      return false;
    }
    await this.prisma.attendanceException.create({
      data: {
        tenantId: bucket.tenantId,
        employeeId: bucket.employeeId,
        type: 'RECURRING_PATTERN',
        severity: 'HIGH',
        payrollImpact: 'REVIEW_REQUIRED',
        dedupeKey,
        details,
      },
    });
    return true;
  }
}
