import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { LeaveType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { UpdateLeaveTypeDto } from './dto/update-leave-type.dto';

@Injectable()
export class LeaveTypesService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string, includeInactive = false): Promise<LeaveType[]> {
    return this.prisma.leaveType.findMany({
      where: { tenantId, ...(includeInactive ? {} : { active: true }) },
      orderBy: { name: 'asc' },
    });
  }

  async get(tenantId: string, id: string): Promise<LeaveType> {
    const leaveType = await this.prisma.leaveType.findFirst({ where: { id, tenantId } });
    if (!leaveType) throw new NotFoundException('Leave type not found');
    return leaveType;
  }

  async create(tenantId: string, actorSubject: string, dto: CreateLeaveTypeDto): Promise<LeaveType> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.leaveType.create({
          data: {
            tenantId,
            name: dto.name,
            code: dto.code,
            paid: dto.paid ?? true,
            defaultAnnualDays: dto.defaultAnnualDays ?? null,
            isCompOff: dto.isCompOff ?? false,
          },
        });
        await tx.auditEvent.create({
          data: {
            tenantId,
            actorSubject,
            action: 'leave_type.created',
            entityType: 'LeaveType',
            entityId: created.id,
            after: { name: created.name, code: created.code, paid: created.paid },
          },
        });
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A leave type with this code already exists');
      }
      throw error;
    }
  }

  async update(
    tenantId: string,
    id: string,
    actorSubject: string,
    dto: UpdateLeaveTypeDto,
  ): Promise<LeaveType> {
    const existing = await this.prisma.leaveType.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Leave type not found');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.leaveType.update({
        where: { id },
        data: {
          name: dto.name,
          paid: dto.paid ?? existing.paid,
          defaultAnnualDays: dto.defaultAnnualDays ?? null,
          active: dto.active ?? existing.active,
          isCompOff: dto.isCompOff ?? existing.isCompOff,
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorSubject,
          action: 'leave_type.updated',
          entityType: 'LeaveType',
          entityId: id,
          before: { name: existing.name, paid: existing.paid, active: existing.active },
          after: { name: updated.name, paid: updated.paid, active: updated.active },
        },
      });
      return updated;
    });
  }
}
