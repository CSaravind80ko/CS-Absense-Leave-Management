import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface LoginMetadata {
  issuer: string;
  clientId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  endSessionEndpoint: string;
  scopes: string[];
}

const safeLoginSelect = {
  issuer: true,
  clientId: true,
  authorizationEndpoint: true,
  tokenEndpoint: true,
  endSessionEndpoint: true,
  scopes: true,
} as const;

@Injectable()
export class IdentityDiscoveryService {
  constructor(private readonly prisma: PrismaService) {}

  async discover(organization: string): Promise<LoginMetadata> {
    const routingKey = organization.trim().toLowerCase();
    const dedicated = await this.prisma.identityConnection.findFirst({
      where: {
        status: 'ACTIVE',
        type: 'DEDICATED_COGNITO',
        tenant: { status: 'ACTIVE' },
        OR: [
          { discoverySlug: routingKey },
          { verifiedDomains: { has: routingKey } },
        ],
      },
      select: safeLoginSelect,
    });
    if (dedicated) return dedicated;

    const shared = await this.prisma.identityConnection.findFirst({
      where: {
        status: 'ACTIVE',
        type: 'SHARED_COGNITO',
        isDefault: true,
      },
      select: safeLoginSelect,
    });
    if (!shared) {
      throw new ServiceUnavailableException('Login is temporarily unavailable');
    }
    return shared;
  }
}
