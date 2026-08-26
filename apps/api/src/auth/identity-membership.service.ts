import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const membershipSelect = {
  active: true,
  role: true,
  tenant: {
    select: {
      id: true,
      name: true,
      slug: true,
      timezone: true,
      status: true,
    },
  },
} as const;

@Injectable()
export class IdentityMembershipService {
  constructor(private readonly prisma: PrismaService) {}

  async list(connectionId: string, providerSubject: string) {
    const mappings = await this.prisma.externalIdentity.findMany({
      where: {
        connectionId,
        providerSubject,
        tenantMembership: { active: true, tenant: { status: 'ACTIVE' } },
      },
      select: { tenantMembership: { select: membershipSelect } },
      orderBy: { tenantMembership: { tenant: { name: 'asc' } } },
    });
    if (!this.legacyMigrationEnabled()) {
      return mappings.map(({ tenantMembership }) => tenantMembership);
    }

    await this.migrateLegacyMappings(connectionId, providerSubject);
    const migrated = await this.prisma.externalIdentity.findMany({
      where: {
        connectionId,
        providerSubject,
        tenantMembership: { active: true, tenant: { status: 'ACTIVE' } },
      },
      select: { tenantMembership: { select: membershipSelect } },
      orderBy: { tenantMembership: { tenant: { name: 'asc' } } },
    });
    return migrated.map(({ tenantMembership }) => tenantMembership);
  }

  async find(
    connectionId: string,
    providerSubject: string,
    tenantId: string,
  ) {
    const mapping = await this.prisma.externalIdentity.findUnique({
      where: {
        connectionId_providerSubject_tenantId: {
          connectionId,
          providerSubject,
          tenantId,
        },
      },
      select: { tenantMembership: { select: membershipSelect } },
    });
    if (mapping || !this.legacyMigrationEnabled()) {
      return mapping?.tenantMembership ?? null;
    }

    await this.migrateLegacyMappings(connectionId, providerSubject, tenantId);
    const migrated = await this.prisma.externalIdentity.findUnique({
      where: {
        connectionId_providerSubject_tenantId: {
          connectionId,
          providerSubject,
          tenantId,
        },
      },
      select: { tenantMembership: { select: membershipSelect } },
    });
    return migrated?.tenantMembership ?? null;
  }

  private legacyMigrationEnabled(): boolean {
    return process.env.ALLOW_LEGACY_COGNITO_SUBJECTS === 'true';
  }

  private async migrateLegacyMappings(
    connectionId: string,
    providerSubject: string,
    tenantId?: string,
  ): Promise<void> {
    const connection = await this.prisma.identityConnection.findUnique({
      where: { id: connectionId },
      select: { tenantId: true, status: true },
    });
    if (
      !connection ||
      connection.status !== 'ACTIVE' ||
      (connection.tenantId &&
        tenantId !== undefined &&
        connection.tenantId !== tenantId)
    ) {
      return;
    }

    const legacyMemberships = await this.prisma.tenantMembership.findMany({
      where: {
        cognitoSubject: providerSubject,
        active: true,
        tenant: { status: 'ACTIVE' },
        tenantId: tenantId ?? connection.tenantId ?? undefined,
      },
      select: { id: true, tenantId: true },
    });
    await Promise.all(
      legacyMemberships.map((membership) =>
        this.prisma.externalIdentity.upsert({
          where: {
            connectionId_providerSubject_tenantId: {
              connectionId,
              providerSubject,
              tenantId: membership.tenantId,
            },
          },
          update: {},
          create: {
            connectionId,
            providerSubject,
            tenantId: membership.tenantId,
            tenantMembershipId: membership.id,
          },
        }),
      ),
    );
  }
}
