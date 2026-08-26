import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ApprovalActionType,
  ApprovalRequest,
  ApprovalStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalActionDto } from './dto/approval-action.dto';
import { CreateApprovalDto } from './dto/create-approval.dto';

const FINAL_ACTION_STATUS: Partial<Record<ApprovalActionType, ApprovalStatus>> = {
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
};

@Injectable()
export class ApprovalsService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string, status?: ApprovalStatus): Promise<ApprovalRequest[]> {
    return this.prisma.approvalRequest.findMany({
      where: { tenantId, status },
      include: { actions: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(
    tenantId: string,
    subject: string,
    dto: CreateApprovalDto,
  ): Promise<ApprovalRequest> {
    this.validateTarget(dto);
    await this.ensureTargetBelongsToTenant(tenantId, dto);
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.approvalRequest.create({
        data: {
          tenantId,
          type: dto.type,
          periodId: dto.periodId,
          exceptionId: dto.exceptionId,
          requestedBy: subject,
        },
      });
      await tx.approvalAction.create({
        data: {
          tenantId,
          approvalRequestId: request.id,
          action: 'SUBMITTED',
          actorSubject: subject,
        },
      });
      return request;
    });
  }

  async act(
    tenantId: string,
    id: string,
    subject: string,
    dto: ApprovalActionDto,
  ): Promise<ApprovalRequest> {
    if (dto.action === 'SUBMITTED') {
      throw new BadRequestException('A submitted request cannot be resubmitted');
    }
    const request = await this.prisma.approvalRequest.findFirst({
      where: { id, tenantId },
    });
    if (!request) throw new NotFoundException('Approval request not found');
    if (request.status !== 'PENDING') {
      throw new BadRequestException('Approval request is already final');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.approvalAction.create({
        data: {
          tenantId,
          approvalRequestId: id,
          action: dto.action,
          actorSubject: subject,
          comment: dto.comment,
        },
      });
      return tx.approvalRequest.update({
        where: { id },
        data: { status: FINAL_ACTION_STATUS[dto.action] },
      });
    });
  }

  private validateTarget(dto: CreateApprovalDto): void {
    const valid =
      (dto.type === 'ATTENDANCE_PERIOD' && dto.periodId && !dto.exceptionId) ||
      (dto.type === 'EXCEPTION' && dto.exceptionId && !dto.periodId) ||
      (dto.type === 'PAYROLL_EXPORT' && dto.periodId && !dto.exceptionId);
    if (!valid) {
      throw new BadRequestException('Approval type requires exactly one matching target');
    }
  }

  private async ensureTargetBelongsToTenant(
    tenantId: string,
    dto: CreateApprovalDto,
  ): Promise<void> {
    const count = dto.exceptionId
      ? await this.prisma.attendanceException.count({
          where: { id: dto.exceptionId, tenantId },
        })
      : await this.prisma.processingPeriod.count({
          where: { id: dto.periodId, tenantId },
        });
    if (count !== 1) throw new NotFoundException('Approval target not found');
  }
}
