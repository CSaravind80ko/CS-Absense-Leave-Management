import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceSourceConnection,
  AttendanceSourceConnectionStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateConnectionDto } from './dto/create-connection.dto';
import { RecordSyncLogDto } from './dto/record-sync-log.dto';
import { UpdateConnectionDto } from './dto/update-connection.dto';
import { UpdateConnectionStatusDto } from './dto/update-connection-status.dto';

const FORWARD_TRANSITIONS: Readonly<
  Record<AttendanceSourceConnectionStatus, readonly AttendanceSourceConnectionStatus[]>
> = {
  DRAFT: ['READY'],
  READY: ['ACTIVE', 'DISABLED'],
  ACTIVE: ['DISABLED'],
  DISABLED: ['READY'],
};

@Injectable()
export class AttendanceSourceConnectionsService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.attendanceSourceConnection.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(tenantId: string, id: string) {
    const connection = await this.prisma.attendanceSourceConnection.findFirst({
      where: { id, tenantId },
      include: { syncLogs: { orderBy: { occurredAt: 'desc' }, take: 20 } },
    });
    if (!connection) throw new NotFoundException('Connection not found');
    return connection;
  }

  create(tenantId: string, subject: string, dto: CreateConnectionDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.attendanceSourceConnection.count({
        where: { tenantId, name: dto.name },
      });
      if (existing) {
        throw new ConflictException(
          'A connection with this name already exists for this tenant',
        );
      }
      const created = await tx.attendanceSourceConnection.create({
        data: {
          tenantId,
          type: dto.type,
          name: dto.name,
          config: (dto.config as Prisma.InputJsonValue) ?? undefined,
          credentialReference: dto.credentialReference,
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorSubject: subject,
          action: 'attendance_source_connection.created',
          entityType: 'AttendanceSourceConnection',
          entityId: created.id,
          metadata: { type: dto.type, name: dto.name },
        },
      });
      return created;
    });
  }

  async update(
    tenantId: string,
    subject: string,
    id: string,
    dto: UpdateConnectionDto,
  ): Promise<AttendanceSourceConnection> {
    await this.ensureConnection(tenantId, id);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.attendanceSourceConnection.update({
        where: { id },
        data: {
          name: dto.name,
          config: dto.config !== undefined ? (dto.config as Prisma.InputJsonValue) : undefined,
          credentialReference: dto.credentialReference,
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorSubject: subject,
          action: 'attendance_source_connection.updated',
          entityType: 'AttendanceSourceConnection',
          entityId: id,
        },
      });
      return updated;
    });
  }

  async updateStatus(
    tenantId: string,
    subject: string,
    id: string,
    dto: UpdateConnectionStatusDto,
  ): Promise<AttendanceSourceConnection> {
    const connection = await this.ensureConnection(tenantId, id);
    const allowed = FORWARD_TRANSITIONS[connection.status]?.includes(dto.status);
    if (!allowed) {
      throw new BadRequestException(
        `Cannot transition connection from ${connection.status} to ${dto.status}`,
      );
    }
    if (dto.status === 'READY' || dto.status === 'ACTIVE') {
      const config = connection.config as Record<string, unknown> | null;
      if (!config || Object.keys(config).length === 0) {
        throw new BadRequestException(
          'Connection config must be set before it can be marked READY or ACTIVE',
        );
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.attendanceSourceConnection.update({
        where: { id },
        data: {
          status: dto.status,
          activatedAt: dto.status === 'ACTIVE' ? new Date() : connection.activatedAt,
          disabledAt: dto.status === 'DISABLED' ? new Date() : null,
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorSubject: subject,
          action: 'attendance_source_connection.status_changed',
          entityType: 'AttendanceSourceConnection',
          entityId: id,
          before: { status: connection.status },
          after: { status: dto.status },
        },
      });
      return updated;
    });
  }

  async recordSyncLog(
    tenantId: string,
    subject: string,
    connectionId: string,
    dto: RecordSyncLogDto,
  ) {
    await this.ensureConnection(tenantId, connectionId);
    return this.prisma.$transaction(async (tx) => {
      const log = await tx.attendanceSourceSyncLog.create({
        data: {
          tenantId,
          connectionId,
          status: dto.status,
          recordCount: dto.recordCount,
          note: dto.note,
          recordedBy: subject,
        },
      });
      await tx.attendanceSourceConnection.update({
        where: { id: connectionId },
        data: {
          lastSyncAt: log.occurredAt,
          lastSyncStatus: dto.status,
          lastSyncRecordCount: dto.recordCount,
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorSubject: subject,
          action: 'attendance_source_connection.sync_logged',
          entityType: 'AttendanceSourceConnection',
          entityId: connectionId,
          metadata: { status: dto.status, recordCount: dto.recordCount },
        },
      });
      return log;
    });
  }

  private async ensureConnection(
    tenantId: string,
    id: string,
  ): Promise<AttendanceSourceConnection> {
    const connection = await this.prisma.attendanceSourceConnection.findFirst({
      where: { id, tenantId },
    });
    if (!connection) throw new NotFoundException('Connection not found');
    return connection;
  }
}
