import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  type CognitoAdminClient,
  type CognitoAdminClientFactory,
} from '../src/tenant-users/cognito-admin';
import { TenantUsersService } from '../src/tenant-users/tenant-users.service';

describe('TenantUsersService', () => {
  it('never sends a Cognito admin command for another tenant membership', async () => {
    const send = jest.fn();
    const client = { send } as unknown as CognitoAdminClient;
    const factory = jest.fn(() => client) as CognitoAdminClientFactory;
    const prisma = {
      tenantMembership: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new TenantUsersService(prisma, factory);

    await expect(
      service.disable('tenant-a', 'membership-from-tenant-b', 'admin-subject'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(factory).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('prefers an active dedicated tenant connection over the shared pool', async () => {
    const dedicated = {
      id: 'dedicated-connection',
      cognitoUserPoolId: 'pool-dedicated',
      awsRegion: 'ap-south-1',
      mfaPolicy: 'OPTIONAL',
    };
    const send = jest.fn().mockResolvedValue({
      User: {
        Username: 'provider-username',
        UserStatus: 'FORCE_CHANGE_PASSWORD',
        Enabled: true,
        Attributes: [
          { Name: 'sub', Value: 'provider-subject' },
          { Name: 'email', Value: 'new.user@example.com' },
        ],
      },
    });
    const transaction = jest.fn(async (callback: (tx: unknown) => unknown) =>
      callback({
        tenantMembership: {
          create: jest.fn().mockResolvedValue({ id: 'membership-1' }),
        },
        userInvitation: { create: jest.fn().mockResolvedValue({}) },
        auditEvent: { create: jest.fn().mockResolvedValue({}) },
      }),
    );
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(dedicated);
    const prisma = {
      tenantMembership: { findFirst },
      identityConnection: { findFirst },
      $transaction: transaction,
    } as unknown as PrismaService;
    const service = new TenantUsersService(
      prisma,
      () => ({ send }) as unknown as CognitoAdminClient,
    );

    await service.invite('tenant-a', 'admin-subject', {
      email: 'New.User@example.com',
      role: 'EMPLOYEE',
      mfaRequired: false,
    });

    expect(findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-a',
          type: 'DEDICATED_COGNITO',
        }),
      }),
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('disables only the tenant membership when a shared identity has other active tenants', async () => {
    const send = jest.fn();
    const update = jest.fn().mockResolvedValue({ id: 'membership-a' });
    const prisma = {
      tenantMembership: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'membership-a',
          role: 'EMPLOYEE',
          mfaRequired: false,
          externalIdentities: [
            {
              providerUsername: 'shared-user',
              providerSubject: 'shared-subject',
              connection: {
                id: 'shared-connection',
                type: 'SHARED_COGNITO',
                cognitoUserPoolId: 'shared-pool',
                awsRegion: 'ap-south-1',
                mfaPolicy: 'REQUIRED',
              },
            },
          ],
        }),
      },
      externalIdentity: { count: jest.fn().mockResolvedValue(1) },
      $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
        callback({
          tenantMembership: { update },
          auditEvent: { create: jest.fn().mockResolvedValue({}) },
        }),
      ),
    } as unknown as PrismaService;
    const service = new TenantUsersService(
      prisma,
      () => ({ send }) as unknown as CognitoAdminClient,
    );

    await service.disable('tenant-a', 'membership-a', 'admin-subject');

    expect(send).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'membership-a' },
        data: expect.objectContaining({
          active: false,
          lifecycleStatus: 'DISABLED',
        }),
      }),
    );
  });
});
