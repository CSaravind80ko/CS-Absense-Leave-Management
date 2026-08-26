import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { PrismaService } from '../src/prisma/prisma.service';
import { ScimException } from '../src/scim/scim-protocol';
import {
  type CognitoAdminClient,
  type CognitoAdminClientFactory,
} from '../src/tenant-users/cognito-admin';
import { ScimService } from '../src/scim/scim.service';

const context = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  samlConnectionId: '22222222-2222-4222-8222-222222222222',
  provisioningConnectionId: '33333333-3333-4333-8333-333333333333',
  identityConnectionId: '44444444-4444-4444-8444-444444444444',
  credentialId: 'credential-1',
};

function identityConnection() {
  return {
    id: context.identityConnectionId,
    type: 'DEDICATED_COGNITO',
    cognitoUserPoolId: 'pool-1',
    awsRegion: 'ap-south-1',
  };
}

describe('ScimService', () => {
  it('compensates Cognito when persistence fails and never conflates username with sub', async () => {
    const send = jest.fn(async (command: unknown) => {
      if (command instanceof AdminCreateUserCommand) {
        return {
          User: {
            Username: 'scim-provider-username',
            Attributes: [{ Name: 'sub', Value: 'immutable-cognito-sub' }],
          },
        };
      }
      return {};
    });
    const prisma = {
      scimUser: { findFirst: jest.fn().mockResolvedValue(null) },
      identityConnection: {
        findFirst: jest.fn().mockResolvedValue(identityConnection()),
      },
      $transaction: jest.fn().mockRejectedValue(new Error('database failed')),
    } as unknown as PrismaService;
    const service = new ScimService(
      prisma,
      (() => ({ send }) as unknown as CognitoAdminClient) as CognitoAdminClientFactory,
    );

    await expect(
      service.createUser(
        context,
        {
          userName: 'employee@example.com',
          emails: [{ value: 'employee@example.com', primary: true }],
          active: true,
        },
        'https://example.test/scim',
      ),
    ).rejects.toThrow('database failed');
    expect(send.mock.calls[0][0]).toBeInstanceOf(AdminCreateUserCommand);
    expect(send.mock.calls.at(-1)?.[0]).toBeInstanceOf(AdminDeleteUserCommand);
  });

  it('creates immutable external identity fields from Cognito results', async () => {
    const send = jest.fn().mockResolvedValue({
      User: {
        Username: 'provider-username',
        Attributes: [{ Name: 'sub', Value: 'verified-cognito-sub' }],
      },
    });
    let externalIdentityData: Record<string, unknown> | undefined;
    const now = new Date();
    const tx = {
      scimProvisioningConnection: {
        findFirst: jest.fn().mockResolvedValue({ defaultRole: 'EMPLOYEE' }),
      },
      tenantMembership: { create: jest.fn().mockResolvedValue({}) },
      externalIdentity: {
        create: jest.fn(async ({ data }) => {
          externalIdentityData = data;
          return data;
        }),
      },
      scimUser: {
        create: jest.fn(async ({ data }) => ({
          ...data,
          createdAt: now,
          updatedAt: now,
          version: 1,
          groupMemberships: [],
          externalIdentity: {
            providerSubject: 'verified-cognito-sub',
            providerUsername: 'provider-username',
          },
        })),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      scimUser: { findFirst: jest.fn().mockResolvedValue(null) },
      identityConnection: {
        findFirst: jest.fn().mockResolvedValue(identityConnection()),
      },
      $transaction: jest.fn(async (callback) => callback(tx)),
    } as unknown as PrismaService;
    const service = new ScimService(
      prisma,
      (() => ({ send }) as unknown as CognitoAdminClient) as CognitoAdminClientFactory,
    );

    await service.createUser(
      context,
      {
        userName: 'employee@example.com',
        externalId: 'entra-object-id',
        emails: [{ value: 'employee@example.com', primary: true }],
      },
      'https://example.test/scim',
    );

    expect(externalIdentityData).toMatchObject({
      tenantId: context.tenantId,
      connectionId: context.identityConnectionId,
      providerSubject: 'verified-cognito-sub',
      providerUsername: 'provider-username',
    });
    expect(externalIdentityData?.providerSubject).not.toEqual(
      externalIdentityData?.providerUsername,
    );
    expect(JSON.stringify(tx.auditEvent.create.mock.calls)).not.toContain(
      'employee@example.com',
    );
  });

  it('rejects cross-connection group members before writing', async () => {
    const prisma = {
      scimGroup: { findFirst: jest.fn().mockResolvedValue(null) },
      scimUser: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const service = new ScimService(prisma, jest.fn() as never);

    await expect(
      service.createGroup(
        context,
        {
          displayName: 'Employees',
          members: [{ value: '55555555-5555-4555-8555-555555555555' }],
        },
        'https://example.test/scim',
      ),
    ).rejects.toBeInstanceOf(ScimException);
    expect(prisma.scimUser.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: context.tenantId,
          provisioningConnectionId: context.provisioningConnectionId,
        }),
      }),
    );
  });

  it('returns no-op group member PATCHes without rewriting membership', async () => {
    const now = new Date();
    const memberId = '55555555-5555-4555-8555-555555555555';
    const group = {
      id: '66666666-6666-4666-8666-666666666666',
      tenantId: context.tenantId,
      provisioningConnectionId: context.provisioningConnectionId,
      displayName: 'Employees',
      normalizedDisplayName: 'employees',
      externalId: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      members: [
        {
          groupId: '66666666-6666-4666-8666-666666666666',
          userId: memberId,
          createdAt: now,
          tenantId: context.tenantId,
          provisioningConnectionId: context.provisioningConnectionId,
          user: { id: memberId, userName: 'employee@example.com' },
        },
      ],
    };
    const prisma = {
      scimGroup: { findFirst: jest.fn().mockResolvedValue(group) },
      scimUser: { findMany: jest.fn().mockResolvedValue([{ id: memberId }]) },
      $transaction: jest.fn(),
    } as unknown as PrismaService;
    const service = new ScimService(prisma, jest.fn() as never);
    const response = await service.patchGroup(
      context,
      group.id,
      {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'add', path: 'members', value: [{ value: memberId }] }],
      },
      'https://example.test/scim',
    );

    expect(response.meta.version).toBe('W/"1"');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('ignores unconfirmed privileged group mappings when calculating roles', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      scimUser: {
        findFirst: jest.fn().mockResolvedValue({
          tenantMembershipId: 'membership-1',
          provisioningConnection: {
            defaultRole: 'EMPLOYEE',
            privilegedRolePolicy: false,
          },
          groupMemberships: [
            {
              group: {
                roleMapping: {
                  role: 'TENANT_ADMIN',
                  privilegedConfirmedAt: new Date(),
                },
              },
            },
          ],
        }),
      },
      tenantMembership: { updateMany },
    } as unknown as PrismaService;
    const service = new ScimService(prisma, jest.fn() as never);

    await service.recalculateRole(context, 'user-1');

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: 'EMPLOYEE' } }),
    );
  });
});
