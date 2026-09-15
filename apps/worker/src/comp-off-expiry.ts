import { PrismaClient } from '@prisma/client';
import { log } from './logger';

/**
 * Approximate clawback: LeaveBalance is a pooled total per employee/leave-type/year, not
 * tracked per credit lot, so an expired credit's days are reclaimed only up to the pool's
 * current headroom (allocatedDays - usedDays). This can under-claw if the pool has already
 * absorbed other since-expired credits' usage, but it never claws back days an employee has
 * already taken - see the design discussion this follows up on for why exact lot tracking
 * was deferred.
 */
export class CompOffExpiryService {
  constructor(private readonly prisma: PrismaClient) {}

  async sweep(limit = 200): Promise<number> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const expired = await this.prisma.compOffCredit.findMany({
      where: { status: 'APPROVED', expiresAt: { lt: today } },
      select: {
        id: true,
        tenantId: true,
        employeeId: true,
        workedDate: true,
        creditDays: true,
      },
      take: limit,
    });
    let processed = 0;
    for (const credit of expired) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const current = await tx.compOffCredit.findFirst({
            where: { id: credit.id, tenantId: credit.tenantId, status: 'APPROVED' },
          });
          if (!current) return;

          const compOffType = await tx.leaveType.findFirst({
            where: { tenantId: credit.tenantId, isCompOff: true, active: true },
          });
          let clawedBackDays: string | null = null;
          if (compOffType) {
            const year = credit.workedDate.getUTCFullYear();
            const balance = await tx.leaveBalance.findFirst({
              where: {
                tenantId: credit.tenantId,
                employeeId: credit.employeeId,
                leaveTypeId: compOffType.id,
                year,
              },
            });
            if (balance) {
              const headroom = balance.allocatedDays.minus(balance.usedDays);
              if (headroom.greaterThan(0)) {
                const clawback = credit.creditDays.lessThan(headroom)
                  ? credit.creditDays
                  : headroom;
                await tx.leaveBalance.update({
                  where: { id: balance.id },
                  data: { allocatedDays: { decrement: clawback } },
                });
                clawedBackDays = clawback.toString();
              }
            }
          }

          await tx.compOffCredit.update({
            where: { id: credit.id },
            data: { status: 'EXPIRED' },
          });
          await tx.auditEvent.create({
            data: {
              tenantId: credit.tenantId,
              actorSubject: 'system:comp-off-expiry',
              action: 'comp_off_credit.expired',
              entityType: 'CompOffCredit',
              entityId: credit.id,
              metadata: {
                employeeId: credit.employeeId,
                creditDays: credit.creditDays.toString(),
                clawedBackDays,
              },
            },
          });
        });
        processed += 1;
      } catch (error) {
        log('error', 'comp-off expiry sweep failed for credit', {
          compOffCreditId: credit.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return processed;
  }
}
