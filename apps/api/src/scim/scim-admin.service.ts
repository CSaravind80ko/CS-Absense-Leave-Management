import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApplicationRole, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScimAuthService } from './scim-auth.service';
import { ScimService } from './scim.service';

const SAFE_DEFAULT_ROLES = new Set<ApplicationRole>([
  'HR_ADMIN',
  'MANAGER',
  'PAYROLL_ADMIN',
  'EMPLOYEE',
  'AUDITOR',
]);

@Injectable()
export class ScimAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: ScimAuthService,
    private readonly scim: ScimService,
  ) {}

  async list(tenantId: string) {
    const connections = await this.prisma.samlConnection.findMany({
      where: { tenantId },
      select: {
        id: true,
        cognitoProviderName: true,
        status: true,
        identityConnection: {
          select: { id: true, status: true, type: true },
        },
        scimConnection: {
          select: {
            id: true,
            enabled: true,
            defaultRole: true,
            privilegedRolePolicy: true,
            enabledAt: true,
            disabledAt: true,
            credentials: {
              select: {
                id: true,
                tokenPrefix: true,
                label: true,
                createdAt: true,
                expiresAt: true,
                lastUsedAt: true,
                revokedAt: true,
              },
              orderBy: { createdAt: 'desc' },
            },
            _count: { select: { users: true, groups: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return connections.map((connection) => ({
      samlConnectionId: connection.id,
      providerName: connection.cognitoProviderName,
      samlStatus: connection.status,
      identityStatus: connection.identityConnection.status,
      identityType: connection.identityConnection.type,
      eligible:
        connection.status === 'ACTIVE' &&
        connection.identityConnection.status === 'ACTIVE',
      baseUrl: this.baseUrl(tenantId, connection.id),
      provisioning: connection.scimConnection,
    }));
  }

  async enable(
    tenantId: string,
    samlConnectionId: string,
    actorSubject: string,
    input: unknown,
  ) {
    const value = record(input);
    const defaultRole = role(value.defaultRole ?? 'EMPLOYEE');
    assertSafeDefault(defaultRole);
    const connection = await this.activeSamlConnection(
      tenantId,
      samlConnectionId,
    );
    return this.prisma.$transaction(async (tx) => {
      const scimConnection = await tx.scimProvisioningConnection.upsert({
        where: { samlConnectionId },
        create: {
          tenantId,
          samlConnectionId,
          identityConnectionId: connection.identityConnectionId,
          defaultRole,
        },
        update: {
          enabled: true,
          defaultRole,
          enabledAt: new Date(),
          disabledAt: null,
        },
      });
      await this.auditTx(
        tx,
        tenantId,
        actorSubject,
        'scim.connection.enabled',
        scimConnection.id,
        { samlConnectionId, defaultRole },
      );
      return {
        ...scimConnection,
        baseUrl: this.baseUrl(tenantId, samlConnectionId),
      };
    });
  }

  async disable(
    tenantId: string,
    samlConnectionId: string,
    actorSubject: string,
  ) {
    const connection = await this.provisioningConnection(
      tenantId,
      samlConnectionId,
      false,
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.scimProvisioningConnection.update({
        where: { id: connection.id },
        data: { enabled: false, disabledAt: new Date() },
      });
      await tx.scimCredential.updateMany({
        where: { provisioningConnectionId: connection.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedBySubject: actorSubject },
      });
      await this.auditTx(
        tx,
        tenantId,
        actorSubject,
        'scim.connection.disabled',
        connection.id,
      );
    });
  }

  async issueCredential(
    tenantId: string,
    samlConnectionId: string,
    actorSubject: string,
    input: unknown,
  ) {
    const value = record(input);
    const label = text(value.label ?? 'Provisioning credential', 'label', 100);
    const expiresAt = expiry(value.expiresAt);
    const connection = await this.provisioningConnection(
      tenantId,
      samlConnectionId,
      true,
    );
    return this.prisma.$transaction(async (tx) => {
      const result = await this.auth.issue(tx, {
        tenantId,
        provisioningConnectionId: connection.id,
        actorSubject,
        label,
        expiresAt,
      });
      await this.auditTx(
        tx,
        tenantId,
        actorSubject,
        'scim.credential.issued',
        result.credential.id,
        {
          connectionId: connection.id,
          tokenPrefix: result.credential.tokenPrefix,
          expiresAt: result.credential.expiresAt?.toISOString() ?? null,
        },
      );
      return {
        ...result,
        baseUrl: this.baseUrl(tenantId, samlConnectionId),
      };
    });
  }

  async rotateCredential(
    tenantId: string,
    samlConnectionId: string,
    actorSubject: string,
    input: unknown,
  ) {
    const value = record(input);
    const label = text(value.label ?? 'Rotated credential', 'label', 100);
    const expiresAt = expiry(value.expiresAt);
    const connection = await this.provisioningConnection(
      tenantId,
      samlConnectionId,
      true,
    );
    return this.prisma.$transaction(async (tx) => {
      const revoked = await tx.scimCredential.updateMany({
        where: { provisioningConnectionId: connection.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedBySubject: actorSubject },
      });
      const result = await this.auth.issue(tx, {
        tenantId,
        provisioningConnectionId: connection.id,
        actorSubject,
        label,
        expiresAt,
      });
      await this.auditTx(
        tx,
        tenantId,
        actorSubject,
        'scim.credential.rotated',
        result.credential.id,
        {
          connectionId: connection.id,
          revokedCredentials: revoked.count,
          tokenPrefix: result.credential.tokenPrefix,
          expiresAt: result.credential.expiresAt?.toISOString() ?? null,
        },
      );
      return {
        ...result,
        baseUrl: this.baseUrl(tenantId, samlConnectionId),
      };
    });
  }

  async revokeCredential(
    tenantId: string,
    samlConnectionId: string,
    credentialId: string,
    actorSubject: string,
  ) {
    const connection = await this.provisioningConnection(
      tenantId,
      samlConnectionId,
      false,
    );
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.scimCredential.updateMany({
        where: {
          id: credentialId,
          tenantId,
          provisioningConnectionId: connection.id,
          revokedAt: null,
        },
        data: { revokedAt: new Date(), revokedBySubject: actorSubject },
      });
      if (updated.count !== 1) {
        throw new NotFoundException('Active SCIM credential was not found');
      }
      await this.auditTx(
        tx,
        tenantId,
        actorSubject,
        'scim.credential.revoked',
        credentialId,
        { connectionId: connection.id },
      );
    });
  }

  async updateSettings(
    tenantId: string,
    samlConnectionId: string,
    actorSubject: string,
    input: unknown,
  ) {
    const value = record(input);
    const defaultRole = role(value.defaultRole);
    assertSafeDefault(defaultRole);
    if (typeof value.privilegedRolePolicy !== 'boolean') {
      throw new BadRequestException('privilegedRolePolicy must be boolean');
    }
    if (
      value.privilegedRolePolicy &&
      value.confirmPrivilegedAccess !== true
    ) {
      throw new BadRequestException(
        'Explicit privileged access confirmation is required',
      );
    }
    const privilegedRolePolicy = value.privilegedRolePolicy;
    const connection = await this.provisioningConnection(
      tenantId,
      samlConnectionId,
      true,
    );
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.scimProvisioningConnection.update({
        where: { id: connection.id },
        data: {
          defaultRole,
          privilegedRolePolicy,
        },
      });
      if (!privilegedRolePolicy) {
        await tx.scimGroupRoleMapping.updateMany({
          where: {
            provisioningConnectionId: connection.id,
            role: 'TENANT_ADMIN',
          },
          data: {
            privilegedConfirmedAt: null,
            privilegedConfirmedBy: null,
          },
        });
      }
      await this.auditTx(
        tx,
        tenantId,
        actorSubject,
        'scim.settings.updated',
        connection.id,
        { defaultRole, privilegedRolePolicy },
      );
      return result;
    });
    await this.recalculateAll(connection.id, tenantId, samlConnectionId);
    return updated;
  }

  async groups(tenantId: string, samlConnectionId: string) {
    const connection = await this.provisioningConnection(
      tenantId,
      samlConnectionId,
      false,
    );
    return this.prisma.scimGroup.findMany({
      where: { tenantId, provisioningConnectionId: connection.id },
      select: {
        id: true,
        displayName: true,
        externalId: true,
        _count: { select: { members: true } },
        roleMapping: {
          select: {
            role: true,
            privilegedConfirmedAt: true,
            updatedAt: true,
          },
        },
      },
      orderBy: { displayName: 'asc' },
    });
  }

  async mapGroupRole(
    tenantId: string,
    samlConnectionId: string,
    groupId: string,
    actorSubject: string,
    input: unknown,
  ) {
    const value = record(input);
    const mappedRole = role(value.role);
    const connection = await this.provisioningConnection(
      tenantId,
      samlConnectionId,
      true,
    );
    if (
      mappedRole === 'TENANT_ADMIN' &&
      (!connection.privilegedRolePolicy ||
        value.confirmPrivilegedAccess !== true)
    ) {
      throw new BadRequestException(
        'TENANT_ADMIN mapping requires the privileged policy and explicit confirmation',
      );
    }
    const group = await this.prisma.scimGroup.findFirst({
      where: {
        id: groupId,
        tenantId,
        provisioningConnectionId: connection.id,
      },
      select: { id: true, members: { select: { userId: true } } },
    });
    if (!group) throw new NotFoundException('SCIM group was not found');
    const mapping = await this.prisma.$transaction(async (tx) => {
      const result = await tx.scimGroupRoleMapping.upsert({
        where: { groupId },
        create: {
          tenantId,
          provisioningConnectionId: connection.id,
          groupId,
          role: mappedRole,
          createdBySubject: actorSubject,
          privilegedConfirmedAt:
            mappedRole === 'TENANT_ADMIN' ? new Date() : null,
          privilegedConfirmedBy:
            mappedRole === 'TENANT_ADMIN' ? actorSubject : null,
        },
        update: {
          role: mappedRole,
          privilegedConfirmedAt:
            mappedRole === 'TENANT_ADMIN' ? new Date() : null,
          privilegedConfirmedBy:
            mappedRole === 'TENANT_ADMIN' ? actorSubject : null,
        },
      });
      await this.auditTx(
        tx,
        tenantId,
        actorSubject,
        'scim.group_role_mapping.updated',
        groupId,
        { role: mappedRole },
      );
      return result;
    });
    await this.recalculateUsers(
      tenantId,
      samlConnectionId,
      connection,
      group.members.map((member) => member.userId),
    );
    return mapping;
  }

  async deleteGroupRoleMapping(
    tenantId: string,
    samlConnectionId: string,
    groupId: string,
    actorSubject: string,
  ) {
    const connection = await this.provisioningConnection(
      tenantId,
      samlConnectionId,
      true,
    );
    const group = await this.prisma.scimGroup.findFirst({
      where: {
        id: groupId,
        tenantId,
        provisioningConnectionId: connection.id,
      },
      select: { members: { select: { userId: true } } },
    });
    if (!group) throw new NotFoundException('SCIM group was not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.scimGroupRoleMapping.deleteMany({
        where: {
          groupId,
          tenantId,
          provisioningConnectionId: connection.id,
        },
      });
      await this.auditTx(
        tx,
        tenantId,
        actorSubject,
        'scim.group_role_mapping.deleted',
        groupId,
      );
    });
    await this.recalculateUsers(
      tenantId,
      samlConnectionId,
      connection,
      group.members.map((member) => member.userId),
    );
  }

  async events(tenantId: string, samlConnectionId: string) {
    const connection = await this.provisioningConnection(
      tenantId,
      samlConnectionId,
      false,
    );
    return this.prisma.auditEvent.findMany({
      where: {
        tenantId,
        action: { startsWith: 'scim.' },
        OR: [
          { entityId: connection.id },
          {
            metadata: {
              path: ['connectionId'],
              equals: connection.id,
            },
          },
        ],
      },
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        occurredAt: true,
        metadata: true,
      },
      orderBy: { occurredAt: 'desc' },
      take: 50,
    });
  }

  private async activeSamlConnection(
    tenantId: string,
    samlConnectionId: string,
  ) {
    const connection = await this.prisma.samlConnection.findFirst({
      where: {
        id: samlConnectionId,
        tenantId,
        status: 'ACTIVE',
        identityConnection: { status: 'ACTIVE' },
      },
      select: { id: true, identityConnectionId: true },
    });
    if (!connection) {
      throw new ConflictException(
        'SCIM requires active SAML and identity connections',
      );
    }
    return connection;
  }

  private async provisioningConnection(
    tenantId: string,
    samlConnectionId: string,
    requireEnabled: boolean,
  ) {
    const connection = await this.prisma.scimProvisioningConnection.findFirst({
      where: {
        tenantId,
        samlConnectionId,
        ...(requireEnabled ? { enabled: true } : {}),
        samlConnection: { status: 'ACTIVE' },
        identityConnection: { status: 'ACTIVE' },
      },
      select: {
        id: true,
        defaultRole: true,
        privilegedRolePolicy: true,
        identityConnectionId: true,
      },
    });
    if (!connection) {
      throw new ConflictException(
        'An active SCIM connection with active SAML and identity connections is required',
      );
    }
    return connection;
  }

  private async recalculateAll(
    provisioningConnectionId: string,
    tenantId: string,
    samlConnectionId: string,
  ) {
    const users = await this.prisma.scimUser.findMany({
      where: { tenantId, provisioningConnectionId, deletedAt: null },
      select: { id: true },
    });
    const connection = await this.provisioningConnection(
      tenantId,
      samlConnectionId,
      true,
    );
    await this.recalculateUsers(
      tenantId,
      samlConnectionId,
      connection,
      users.map((user) => user.id),
    );
  }

  private async recalculateUsers(
    tenantId: string,
    samlConnectionId: string,
    connection: { id: string; identityConnectionId: string },
    userIds: string[],
  ) {
    for (const userId of [...new Set(userIds)].sort()) {
      await this.scim.recalculateRole(
        {
          tenantId,
          samlConnectionId,
          provisioningConnectionId: connection.id,
          identityConnectionId: connection.identityConnectionId,
          credentialId: 'tenant-admin',
        },
        userId,
      );
    }
  }

  private baseUrl(tenantId: string, samlConnectionId: string) {
    const configured = process.env.SCIM_PUBLIC_BASE_URL?.replace(/\/$/, '');
    return `${configured ?? '/api/v1/scim/v2'}/${tenantId}/${samlConnectionId}`;
  }

  private auditTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorSubject: string,
    action: string,
    entityId: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    return tx.auditEvent.create({
      data: {
        tenantId,
        actorSubject,
        action,
        entityType: action.includes('credential')
          ? 'ScimCredential'
          : action.includes('mapping')
            ? 'ScimGroupRoleMapping'
            : 'ScimProvisioningConnection',
        entityId,
        metadata,
      },
    });
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Request body must be an object');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, maximum: number) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    throw new BadRequestException(
      `${field} must contain between 1 and ${maximum} characters`,
    );
  }
  return value.trim();
}

function role(value: unknown): ApplicationRole {
  if (
    typeof value !== 'string' ||
    !Object.values(ApplicationRole).includes(value as ApplicationRole)
  ) {
    throw new BadRequestException('role is invalid');
  }
  return value as ApplicationRole;
}

function assertSafeDefault(value: ApplicationRole) {
  if (!SAFE_DEFAULT_ROLES.has(value)) {
    throw new BadRequestException(
      'TENANT_ADMIN cannot be configured as the SCIM default role',
    );
  }
}

function expiry(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new BadRequestException('expiresAt must be an ISO date-time');
  }
  const result = new Date(value);
  const now = Date.now();
  if (
    Number.isNaN(result.getTime()) ||
    result.getTime() < now + 60 * 60 * 1000 ||
    result.getTime() > now + 366 * 24 * 60 * 60 * 1000
  ) {
    throw new BadRequestException(
      'expiresAt must be between one hour and 366 days from now',
    );
  }
  return result;
}
