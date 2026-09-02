import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PolicyScopeType, PolicyVersion, Prisma } from '@prisma/client';
import {
  createEvent,
  type AttendanceDayRecomputeRequestedEvent,
} from '@attendance/contracts';
import { PageResult, pageResult } from '../common/dto/page-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import { enqueueOutboxEvent } from '../events/outbox';
import { CreatePolicyVersionDto } from './dto/create-policy-version.dto';
import { UpdatePolicyVersionDto } from './dto/update-policy-version.dto';
import { PublishPolicyVersionDto } from './dto/publish-policy-version.dto';
import { PolicyQueryDto } from './dto/policy-query.dto';
import { ResolvePolicyDto } from './dto/resolve-policy.dto';
import { PolicyResolutionError, resolveEffectivePolicy } from './policy-resolution';

const MS_PER_DAY = 86_400_000;

@Injectable()
export class PoliciesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, query: PolicyQueryDto): Promise<PageResult<PolicyVersion>> {
    const where: Prisma.PolicyVersionWhereInput = {
      tenantId,
      scopeType: query.scopeType,
      scopeId: query.scopeId,
      status: query.status,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.policyVersion.findMany({
        where,
        orderBy: { effectiveFrom: query.order },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.policyVersion.count({ where }),
    ]);
    return pageResult(items, total, query);
  }

  async get(tenantId: string, id: string): Promise<PolicyVersion> {
    const version = await this.prisma.policyVersion.findFirst({ where: { id, tenantId } });
    if (!version) throw new NotFoundException('Policy version not found');
    return version;
  }

  /**
   * The version currently effective (today) for every distinct (scopeType, scopeId) that
   * has at least one PUBLISHED version — the same "latest effectiveFrom <= today per
   * scope" reduction used by resolveEffectivePolicy's precedence resolution.
   */
  async listEffective(tenantId: string): Promise<PolicyVersion[]> {
    const today = new Date(new Date().toISOString().slice(0, 10));
    const versions = await this.prisma.policyVersion.findMany({
      where: { tenantId, status: 'PUBLISHED', effectiveFrom: { lte: today } },
      orderBy: { effectiveFrom: 'desc' },
    });
    const bestByScope = new Map<string, PolicyVersion>();
    for (const version of versions) {
      const key = `${version.scopeType}:${version.scopeId}`;
      if (!bestByScope.has(key)) bestByScope.set(key, version);
    }
    return Array.from(bestByScope.values());
  }

  async createDraft(
    tenantId: string,
    actorSubject: string,
    dto: CreatePolicyVersionDto,
  ): Promise<PolicyVersion> {
    const scopeId = await this.resolveScopeId(tenantId, dto.scopeType, dto.scopeId);
    const effectiveFrom = new Date(dto.effectiveFrom);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.policyVersion.create({
        data: {
          tenantId,
          scopeType: dto.scopeType,
          scopeId,
          name: dto.name,
          effectiveFrom,
          workingWeekdays: dto.workingWeekdays,
          rules: dto.rules as unknown as Prisma.InputJsonValue,
          createdBy: actorSubject,
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorSubject,
          action: 'policy.draft_created',
          entityType: 'PolicyVersion',
          entityId: created.id,
          after: {
            scopeType: created.scopeType,
            scopeId: created.scopeId,
            name: created.name,
            effectiveFrom: dto.effectiveFrom,
          },
        },
      });
      return created;
    });
  }

  async updateDraft(
    tenantId: string,
    id: string,
    actorSubject: string,
    dto: UpdatePolicyVersionDto,
  ): Promise<PolicyVersion> {
    const draft = await this.prisma.policyVersion.findFirst({ where: { id, tenantId } });
    if (!draft) throw new NotFoundException('Policy version not found');
    if (draft.status !== 'DRAFT') {
      throw new ConflictException('Only draft policy versions can be updated');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.policyVersion.updateMany({
        where: { id, tenantId, status: 'DRAFT', version: dto.version },
        data: {
          name: dto.name,
          effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined,
          workingWeekdays: dto.workingWeekdays,
          rules: dto.rules ? (dto.rules as unknown as Prisma.InputJsonValue) : undefined,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          'Policy draft changed; refresh and retry with the latest version',
        );
      }
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorSubject,
          action: 'policy.draft_updated',
          entityType: 'PolicyVersion',
          entityId: id,
          before: { version: draft.version },
          after: { version: draft.version + 1 },
        },
      });
      return tx.policyVersion.findFirstOrThrow({ where: { id, tenantId } });
    });
  }

  async deleteDraft(tenantId: string, id: string, actorSubject: string): Promise<void> {
    const draft = await this.prisma.policyVersion.findFirst({ where: { id, tenantId } });
    if (!draft) throw new NotFoundException('Policy version not found');
    if (draft.status !== 'DRAFT') {
      throw new ConflictException('Only draft policy versions can be deleted');
    }
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.policyVersion.deleteMany({
        where: { id, tenantId, status: 'DRAFT' },
      });
      if (deleted.count !== 1) {
        throw new ConflictException('Policy draft changed; refresh and retry');
      }
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorSubject,
          action: 'policy.draft_deleted',
          entityType: 'PolicyVersion',
          entityId: id,
          before: { scopeType: draft.scopeType, scopeId: draft.scopeId },
        },
      });
    });
  }

  async publish(
    tenantId: string,
    id: string,
    actorSubject: string,
    dto: PublishPolicyVersionDto,
  ): Promise<{ policyVersion: PolicyVersion; recomputeJobId: string }> {
    const draft = await this.prisma.policyVersion.findFirst({ where: { id, tenantId } });
    if (!draft) throw new NotFoundException('Policy version not found');
    if (draft.status !== 'DRAFT') {
      throw new ConflictException('Only draft policy versions can be published');
    }
    const latestPublished = await this.prisma.policyVersion.findFirst({
      where: {
        tenantId,
        scopeType: draft.scopeType,
        scopeId: draft.scopeId,
        status: 'PUBLISHED',
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (latestPublished && draft.effectiveFrom <= latestPublished.effectiveFrom) {
      throw new ConflictException(
        'A published policy version with an equal or later effective date already exists for this scope',
      );
    }
    const maxRecomputeDays = Number(process.env.POLICY_MAX_RECOMPUTE_DAYS ?? 400);
    const today = new Date(new Date().toISOString().slice(0, 10));
    const ageDays = Math.floor((today.getTime() - draft.effectiveFrom.getTime()) / MS_PER_DAY);
    if (ageDays > maxRecomputeDays) {
      throw new BadRequestException(
        `Policy effectiveFrom is more than ${maxRecomputeDays} days in the past; publish with an effective date closer to today`,
      );
    }

    return this.prisma.$transaction(
      async (tx) => {
        const transition = await tx.policyVersion.updateMany({
          where: { id, tenantId, status: 'DRAFT', version: dto.version },
          data: {
            status: 'PUBLISHED',
            publishedAt: new Date(),
            publishedBy: actorSubject,
            supersedesId: latestPublished?.id ?? null,
            version: { increment: 1 },
          },
        });
        if (transition.count !== 1) {
          throw new ConflictException(
            'Policy version changed while publishing; refresh and retry with the latest version',
          );
        }
        const published = await tx.policyVersion.findFirstOrThrow({ where: { id, tenantId } });
        await tx.auditEvent.create({
          data: {
            tenantId,
            actorSubject,
            action: 'policy.published',
            entityType: 'PolicyVersion',
            entityId: id,
            after: {
              scopeType: published.scopeType,
              scopeId: published.scopeId,
              effectiveFrom: published.effectiveFrom.toISOString().slice(0, 10),
            },
          },
        });
        const recomputeJob = await tx.policyRecomputeJob.create({
          data: {
            tenantId,
            scopeType: published.scopeType,
            scopeId: published.scopeId,
            dateFrom: published.effectiveFrom,
            dateTo: today,
            reason: 'POLICY_PUBLISHED',
            triggeredByPolicyVersionId: published.id,
            requestedBy: actorSubject,
          },
        });
        const event = createEvent<AttendanceDayRecomputeRequestedEvent>(
          'attendance.day.recompute-requested.v1',
          {
            tenantId,
            recomputeJobId: recomputeJob.id,
            scopeType: published.scopeType,
            scopeId: published.scopeId,
            dateFrom: published.effectiveFrom.toISOString().slice(0, 10),
            dateTo: today.toISOString().slice(0, 10),
            requestedBy: actorSubject,
            requestedAt: new Date().toISOString(),
          },
        );
        await enqueueOutboxEvent(tx, 'PolicyRecomputeJob', recomputeJob.id, event);
        return { policyVersion: published, recomputeJobId: recomputeJob.id };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async resolve(tenantId: string, dto: ResolvePolicyDto) {
    const workDate = new Date(dto.date);
    try {
      return await resolveEffectivePolicy(this.prisma, tenantId, dto.employeeId, workDate);
    } catch (error) {
      if (error instanceof PolicyResolutionError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  private async resolveScopeId(
    tenantId: string,
    scopeType: PolicyScopeType,
    scopeId: string | undefined,
  ): Promise<string> {
    if (scopeType === 'TENANT') return tenantId;
    if (!scopeId) {
      throw new BadRequestException('scopeId is required for non-TENANT scopes');
    }
    const exists = await this.scopeExists(tenantId, scopeType, scopeId);
    if (!exists) {
      throw new BadRequestException(`${scopeType} scope target was not found for this tenant`);
    }
    return scopeId;
  }

  private async scopeExists(
    tenantId: string,
    scopeType: PolicyScopeType,
    scopeId: string,
  ): Promise<boolean> {
    switch (scopeType) {
      case 'LOCATION':
        return Boolean(
          await this.prisma.location.findFirst({
            where: { id: scopeId, tenantId },
            select: { id: true },
          }),
        );
      case 'DEPARTMENT':
        return Boolean(
          await this.prisma.department.findFirst({
            where: { id: scopeId, tenantId },
            select: { id: true },
          }),
        );
      case 'EMPLOYEE_GROUP':
        return Boolean(
          await this.prisma.employeeGroup.findFirst({
            where: { id: scopeId, tenantId },
            select: { id: true },
          }),
        );
      case 'EMPLOYEE':
        return Boolean(
          await this.prisma.employee.findFirst({
            where: { id: scopeId, tenantId },
            select: { id: true },
          }),
        );
      default:
        return false;
    }
  }
}
