import { PrismaService } from '../src/prisma/prisma.service';
import { IdentityDiscoveryService } from '../src/auth/identity-discovery.service';

const shared = {
  issuer: 'https://issuer.example/shared',
  clientId: 'shared-client',
  authorizationEndpoint: 'https://login.example/oauth2/authorize',
  tokenEndpoint: 'https://login.example/oauth2/token',
  endSessionEndpoint: 'https://login.example/logout',
  scopes: ['openid', 'email', 'profile'],
};

describe('IdentityDiscoveryService', () => {
  it('returns the same safe shared metadata for unknown and standard organizations', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(shared)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(shared);
    const prisma = {
      identityConnection: { findFirst },
    } as unknown as PrismaService;
    const discovery = new IdentityDiscoveryService(prisma);

    await expect(discovery.discover('unknown.example')).resolves.toEqual(shared);
    await expect(discovery.discover('standard-tenant')).resolves.toEqual(shared);
    expect(findFirst).toHaveBeenCalledTimes(4);
  });

  it('routes a verified domain without returning tenant or connection details', async () => {
    const dedicated = {
      ...shared,
      issuer: 'https://issuer.example/dedicated',
      clientId: 'dedicated-client',
    };
    const findFirst = jest.fn().mockResolvedValueOnce(dedicated);
    const prisma = {
      identityConnection: { findFirst },
    } as unknown as PrismaService;

    const result = await new IdentityDiscoveryService(prisma).discover(
      'Enterprise.Example',
    );

    expect(result).toEqual(dedicated);
    expect(result).not.toHaveProperty('tenantId');
    expect(result).not.toHaveProperty('type');
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { discoverySlug: 'enterprise.example' },
            { verifiedDomains: { has: 'enterprise.example' } },
          ],
        }),
      }),
    );
  });
});
