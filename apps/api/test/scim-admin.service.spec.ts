import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { ScimAdminService } from '../src/scim/scim-admin.service';
import { ScimAuthService } from '../src/scim/scim-auth.service';
import { ScimService } from '../src/scim/scim.service';

describe('ScimAdminService', () => {
  it('cannot enable SCIM unless both SAML and identity connections are active', async () => {
    const prisma = {
      samlConnection: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new ScimAdminService(
      prisma,
      {} as ScimAuthService,
      {} as ScimService,
    );

    await expect(
      service.enable('tenant-1', 'saml-1', 'admin', {
        defaultRole: 'EMPLOYEE',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.samlConnection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          status: 'ACTIVE',
          identityConnection: { status: 'ACTIVE' },
        }),
      }),
    );
  });

  it('never permits TENANT_ADMIN as a provider-independent default role', async () => {
    const service = new ScimAdminService(
      {} as PrismaService,
      {} as ScimAuthService,
      {} as ScimService,
    );
    await expect(
      service.enable('tenant-1', 'saml-1', 'admin', {
        defaultRole: 'TENANT_ADMIN',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires privileged policy and confirmation for TENANT_ADMIN mappings', async () => {
    const prisma = {
      scimProvisioningConnection: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'scim-1',
          defaultRole: 'EMPLOYEE',
          privilegedRolePolicy: false,
          identityConnectionId: 'identity-1',
        }),
      },
    } as unknown as PrismaService;
    const service = new ScimAdminService(
      prisma,
      {} as ScimAuthService,
      {} as ScimService,
    );
    await expect(
      service.mapGroupRole(
        'tenant-1',
        'saml-1',
        'group-1',
        'admin',
        { role: 'TENANT_ADMIN', confirmPrivilegedAccess: true },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rotates credentials atomically and audits only prefix metadata', async () => {
    const tx = {
      scimCredential: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      scimProvisioningConnection: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'scim-1',
          defaultRole: 'EMPLOYEE',
          privilegedRolePolicy: false,
          identityConnectionId: 'identity-1',
        }),
      },
      $transaction: jest.fn(async (callback) => callback(tx)),
    } as unknown as PrismaService;
    const auth = {
      issue: jest.fn().mockResolvedValue({
        credential: {
          id: 'credential-new',
          tokenPrefix: 'scim_0123456789abcdef',
          expiresAt: null,
        },
        token: 'scim_0123456789abcdef.one-time-secret',
      }),
    } as unknown as ScimAuthService;
    const service = new ScimAdminService(prisma, auth, {} as ScimService);
    const result = await service.rotateCredential(
      'tenant-1',
      'saml-1',
      'admin',
      { label: 'rotated' },
    );

    expect(tx.scimCredential.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { provisioningConnectionId: 'scim-1', revokedAt: null },
      }),
    );
    expect(result.token).toContain('one-time-secret');
    const auditPayload = JSON.stringify(tx.auditEvent.create.mock.calls);
    expect(auditPayload).toContain('scim_0123456789abcdef');
    expect(auditPayload).not.toContain('one-time-secret');
  });
});
