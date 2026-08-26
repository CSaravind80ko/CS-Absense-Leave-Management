import { HttpStatus, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { ScimAuthService } from '../src/scim/scim-auth.service';
import { ScimException } from '../src/scim/scim-protocol';

describe('ScimAuthService', () => {
  afterEach(() => {
    delete process.env.SCIM_RATE_LIMIT_PER_MINUTE;
  });

  it('returns a high-entropy token once and persists only its derived hash', async () => {
    let stored: Record<string, unknown> | undefined;
    const tx = {
      scimCredential: {
        create: jest.fn(async ({ data }) => {
          stored = data;
          return {
            id: 'credential-1',
            tokenPrefix: data.tokenPrefix,
            label: data.label,
            expiresAt: null,
            createdAt: new Date(),
          };
        }),
      },
    };
    const service = new ScimAuthService({} as PrismaService);
    const result = await service.issue(tx as never, {
      tenantId: 'tenant-1',
      provisioningConnectionId: 'connection-1',
      actorSubject: 'admin-sub',
      label: 'Entra',
    });

    expect(result.token).toMatch(/^scim_[0-9a-f]{16}\.[A-Za-z0-9_-]{40,}$/);
    expect(stored).not.toHaveProperty('token');
    expect(stored?.tokenHash).not.toEqual(result.token);
    expect(stored?.tokenSalt).toBeTruthy();
  });

  it('authenticates only the matching tenant/connection token and tracks use', async () => {
    const credentialRows: Array<Record<string, unknown>> = [];
    const tx = {
      scimCredential: {
        create: jest.fn(async ({ data }) => {
          credentialRows.push(data);
          return {
            id: 'credential-1',
            tokenPrefix: data.tokenPrefix,
            label: data.label,
            expiresAt: null,
            createdAt: new Date(),
          };
        }),
      },
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      scimProvisioningConnection: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'connection-1',
          tenantId: 'tenant-1',
          identityConnectionId: 'identity-1',
        }),
      },
      scimCredential: {
        findFirst: jest.fn(async () => ({
          id: 'credential-1',
          tokenHash: credentialRows[0].tokenHash,
          tokenSalt: credentialRows[0].tokenSalt,
          expiresAt: null,
          lastUsedAt: null,
        })),
        updateMany,
      },
    } as unknown as PrismaService;
    const service = new ScimAuthService(prisma);
    const issued = await service.issue(tx as never, {
      tenantId: 'tenant-1',
      provisioningConnectionId: 'connection-1',
      actorSubject: 'admin-sub',
      label: 'Okta',
    });
    await expect(
      service.authenticate('tenant-1', 'saml-1', issued.token, {
        headers: {},
        params: {},
        method: 'GET',
        originalUrl: '/Users',
        ip: '203.0.113.9',
      }),
    ).resolves.toMatchObject({
      tenantId: 'tenant-1',
      provisioningConnectionId: 'connection-1',
      identityConnectionId: 'identity-1',
      credentialId: 'credential-1',
    });
    expect(
      prisma.scimProvisioningConnection.findFirst,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenant: { status: 'ACTIVE' } }),
      }),
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastUsedIp: '203.0.113.9' }),
      }),
    );
    await expect(
      service.authenticate('other-tenant', 'saml-1', 'wrong-token', {
        headers: {},
        params: {},
        method: 'GET',
        originalUrl: '/Users',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects expired credentials and rate limits each credential', async () => {
    const prisma = {
      scimProvisioningConnection: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'connection-1',
          tenantId: 'tenant-1',
          identityConnectionId: 'identity-1',
        }),
      },
      scimCredential: {
        create: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
    } as unknown as PrismaService;
    const service = new ScimAuthService(prisma);
    const tx = {
      scimCredential: {
        create: jest.fn(async ({ data }) => ({
          id: 'credential-1',
          tokenPrefix: data.tokenPrefix,
          label: data.label,
          expiresAt: null,
          createdAt: new Date(),
        })),
      },
    };
    const issued = await service.issue(tx as never, {
      tenantId: 'tenant-1',
      provisioningConnectionId: 'connection-1',
      actorSubject: 'admin',
      label: 'test',
    });
    const stored = (tx.scimCredential.create as jest.Mock).mock.calls[0][0].data;
    (prisma.scimCredential.findFirst as jest.Mock).mockResolvedValue({
      id: 'credential-1',
      tokenHash: stored.tokenHash,
      tokenSalt: stored.tokenSalt,
      expiresAt: new Date(Date.now() - 1000),
      lastUsedAt: null,
    });
    const request = {
      headers: {},
      params: {},
      method: 'GET',
      originalUrl: '/Users',
    };
    await expect(
      service.authenticate('tenant-1', 'saml-1', issued.token, request),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    (prisma.scimCredential.findFirst as jest.Mock).mockResolvedValue({
      id: 'credential-1',
      tokenHash: stored.tokenHash,
      tokenSalt: stored.tokenSalt,
      expiresAt: null,
      lastUsedAt: new Date(),
    });
    process.env.SCIM_RATE_LIMIT_PER_MINUTE = '1';
    await service.authenticate('tenant-1', 'saml-1', issued.token, request);
    try {
      await service.authenticate('tenant-1', 'saml-1', issued.token, request);
      throw new Error('Expected rate limit rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ScimException);
      expect((error as ScimException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  });
});
