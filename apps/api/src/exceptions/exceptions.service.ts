import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceException, ExceptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DecideExceptionDto } from './dto/decide-exception.dto';

@Injectable()
export class ExceptionsService {
  constructor(private readonly prisma: PrismaService) {}

  list(
    tenantId: string,
    status?: ExceptionStatus,
  ): Promise<AttendanceException[]> {
    return this.prisma.attendanceException.findMany({
      where: { tenantId, status },
      orderBy: { createdAt: 'desc' },
    });
  }

  async decide(
    tenantId: string,
    id: string,
    subject: string,
    dto: DecideExceptionDto,
  ): Promise<AttendanceException> {
    if (dto.decision === 'OPEN') {
      throw new BadRequestException('Decision must resolve or dismiss the exception');
    }
    const existing = await this.prisma.attendanceException.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Attendance exception not found');
    if (existing.status !== 'OPEN') {
      throw new BadRequestException('Exception has already been decided');
    }

    return this.prisma.$transaction(async (tx) => {
      const exception = await tx.attendanceException.update({
        where: { id },
        data: {
          status: dto.decision,
          resolutionNote: dto.note,
          resolvedBy: subject,
          resolvedAt: new Date(),
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorSubject: subject,
          action: `exception.${dto.decision.toLowerCase()}`,
          entityType: 'AttendanceException',
          entityId: id,
          before: { status: existing.status },
          after: { status: dto.decision, note: dto.note },
        },
      });
      return exception;
    });
  }
}
