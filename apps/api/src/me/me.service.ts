import { Injectable } from '@nestjs/common';
import { ApplicationRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  role: ApplicationRole;
}

@Injectable()
export class MeService {
  constructor(private readonly prisma: PrismaService) {}

  async listTenants(cognitoSubject: string): Promise<TenantSummary[]> {
    const memberships = await this.prisma.tenantMembership.findMany({
      where: {
        cognitoSubject,
        active: true,
        tenant: { status: 'ACTIVE' },
      },
      select: {
        role: true,
        tenant: {
          select: { id: true, name: true, slug: true, timezone: true },
        },
      },
      orderBy: { tenant: { name: 'asc' } },
    });

    return memberships.map(({ role, tenant }) => ({ ...tenant, role }));
  }
}
