import { IdentityMembershipService } from '../src/auth/identity-membership.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('IdentityMembershipService', () => {
  const originalLegacySetting = process.env.ALLOW_LEGACY_COGNITO_SUBJECTS;

  afterEach(() => {
    if (originalLegacySetting === undefined) {
      delete process.env.ALLOW_LEGACY_COGNITO_SUBJECTS;
    } else {
      process.env.ALLOW_LEGACY_COGNITO_SUBJECTS = originalLegacySetting;
    }
  });

  it('does not authorize an identity mapped to a different tenant', async () => {
    delete process.env.ALLOW_LEGACY_COGNITO_SUBJECTS;
    const findUnique = jest.fn().mockResolvedValue(null);
    const prisma = {
      externalIdentity: { findUnique },
    } as unknown as PrismaService;

    const result = await new IdentityMembershipService(prisma).find(
      'connection-1',
      'subject-1',
      'tenant-b',
    );

    expect(result).toBeNull();
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          connectionId_providerSubject_tenantId: {
            connectionId: 'connection-1',
            providerSubject: 'subject-1',
            tenantId: 'tenant-b',
          },
        },
      }),
    );
  });

  it('backfills a legacy subject only when the explicit migration flag is enabled', async () => {
    process.env.ALLOW_LEGACY_COGNITO_SUBJECTS = 'true';
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        tenantMembership: {
          active: true,
          role: 'HR_ADMIN',
          tenant: { id: 'tenant-a', status: 'ACTIVE' },
        },
      });
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = {
      externalIdentity: { findUnique, upsert },
      identityConnection: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ tenantId: 'tenant-a', status: 'ACTIVE' }),
      },
      tenantMembership: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'membership-1', tenantId: 'tenant-a' }]),
      },
    } as unknown as PrismaService;

    const result = await new IdentityMembershipService(prisma).find(
      'connection-1',
      'legacy-subject',
      'tenant-a',
    );

    expect(result?.role).toBe('HR_ADMIN');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          connectionId: 'connection-1',
          providerSubject: 'legacy-subject',
          tenantId: 'tenant-a',
          tenantMembershipId: 'membership-1',
        }),
      }),
    );
  });

  it('continues backfilling legacy memberships when some mappings already exist', async () => {
    process.env.ALLOW_LEGACY_COGNITO_SUBJECTS = 'true';
    const existing = {
      tenantMembership: {
        active: true,
        role: 'HR_ADMIN',
        tenant: { id: 'tenant-a', status: 'ACTIVE' },
      },
    };
    const migrated = {
      tenantMembership: {
        active: true,
        role: 'MANAGER',
        tenant: { id: 'tenant-b', status: 'ACTIVE' },
      },
    };
    const externalFindMany = jest
      .fn()
      .mockResolvedValueOnce([existing])
      .mockResolvedValueOnce([existing, migrated]);
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = {
      externalIdentity: { findMany: externalFindMany, upsert },
      identityConnection: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ tenantId: null, status: 'ACTIVE' }),
      },
      tenantMembership: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'membership-a', tenantId: 'tenant-a' },
          { id: 'membership-b', tenantId: 'tenant-b' },
        ]),
      },
    } as unknown as PrismaService;

    const result = await new IdentityMembershipService(prisma).list(
      'shared-connection',
      'legacy-subject',
    );

    expect(result).toHaveLength(2);
    expect(upsert).toHaveBeenCalledTimes(2);
  });
});
