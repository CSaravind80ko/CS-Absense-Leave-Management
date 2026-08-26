import { Injectable } from '@nestjs/common';
import { ApplicationRole } from '@prisma/client';
import { IdentityMembershipService } from '../auth/identity-membership.service';

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  role: ApplicationRole;
}

@Injectable()
export class MeService {
  constructor(
    private readonly identities: IdentityMembershipService,
  ) {}

  async listTenants(
    connectionId: string,
    providerSubject: string,
  ): Promise<TenantSummary[]> {
    const memberships = await this.identities.list(
      connectionId,
      providerSubject,
    );

    return memberships.map(({ role, tenant: { status: _status, ...tenant } }) => ({
      ...tenant,
      role,
    }));
  }
}
