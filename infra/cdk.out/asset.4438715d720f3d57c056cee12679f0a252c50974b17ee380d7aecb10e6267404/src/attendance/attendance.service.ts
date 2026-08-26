import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceImportJob,
  PeriodStatus,
  ProcessingPeriod,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateImportJobDto } from './dto/create-import-job.dto';
import { CreatePeriodDto } from './dto/create-period.dto';

const PERIOD_TRANSITIONS: Readonly<Record<PeriodStatus, readonly PeriodStatus[]>> = {
  OPEN: ['PROCESSING'],
  PROCESSING: ['REVIEW', 'OPEN'],
  REVIEW: ['APPROVED', 'PROCESSING'],
  APPROVED: ['EXPORTED'],
  EXPORTED: ['CLOSED'],
  CLOSED: [],
};

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  listPeriods(tenantId: string): Promise<ProcessingPeriod[]> {
    return this.prisma.processingPeriod.findMany({
      where: { tenantId },
      orderBy: { startsOn: 'desc' },
    });
  }

  async createPeriod(
    tenantId: string,
    dto: CreatePeriodDto,
  ): Promise<ProcessingPeriod> {
    const startsOn = new Date(dto.startsOn);
    const endsOn = new Date(dto.endsOn);
    if (startsOn > endsOn) {
      throw new BadRequestException('startsOn must not be after endsOn');
    }
    const overlap = await this.prisma.processingPeriod.count({
      where: {
        tenantId,
        startsOn: { lte: endsOn },
        endsOn: { gte: startsOn },
      },
    });
    if (overlap) throw new ConflictException('Processing period overlaps an existing period');
    return this.prisma.processingPeriod.create({
      data: { tenantId, name: dto.name, startsOn, endsOn },
    });
  }

  async updatePeriodStatus(
    tenantId: string,
    id: string,
    status: PeriodStatus,
  ): Promise<ProcessingPeriod> {
    const period = await this.prisma.processingPeriod.findFirst({
      where: { id, tenantId },
    });
    if (!period) throw new NotFoundException('Processing period not found');
    if (!PERIOD_TRANSITIONS[period.status].includes(status)) {
      throw new BadRequestException(
        `Cannot transition period from ${period.status} to ${status}`,
      );
    }
    return this.prisma.processingPeriod.update({
      where: { id },
      data: {
        status,
        lockedAt: status === 'APPROVED' ? new Date() : period.lockedAt,
      },
    });
  }

  listImportJobs(tenantId: string, periodId?: string): Promise<AttendanceImportJob[]> {
    return this.prisma.attendanceImportJob.findMany({
      where: { tenantId, periodId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createImportJob(
    tenantId: string,
    subject: string,
    dto: CreateImportJobDto,
  ): Promise<AttendanceImportJob> {
    const period = await this.prisma.processingPeriod.findFirst({
      where: { id: dto.periodId, tenantId },
      select: { status: true },
    });
    if (!period) throw new NotFoundException('Processing period not found');
    if (!['OPEN', 'PROCESSING'].includes(period.status)) {
      throw new BadRequestException('Imports are only allowed in open processing periods');
    }
    return this.prisma.attendanceImportJob.create({
      data: {
        tenantId,
        periodId: dto.periodId,
        requestedBy: subject,
        source: dto.source,
      },
    });
  }
}
