import {
  DeleteIdentityProviderCommand,
  UpdateUserPoolClientCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { SamlConnectionsService } from '../src/saml-connections/saml-connections.service';
import {
  type SamlMetadataStorage,
  SamlMetadataFetcher,
  SamlMetadataValidator,
} from '../src/saml-connections/saml-metadata';
import { type CognitoAdminClient } from '../src/tenant-users/cognito-admin';

const identityConnection = {
  id: 'identity-1',
  tenantId: 'tenant-a',
  type: 'DEDICATED_COGNITO',
  status: 'DISABLED',
  issuer:
    'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_dedicated',
  clientId: 'app-client',
  authorizationEndpoint: 'https://login.example.test/oauth2/authorize',
  tokenEndpoint: 'https://login.example.test/oauth2/token',
  endSessionEndpoint: 'https://login.example.test/logout',
  discoverySlug: 'tenant-a',
  verifiedDomains: [],
  scopes: ['openid', 'email'],
  isDefault: false,
  clientSecretReference: null,
  cognitoUserPoolId: 'ap-south-1_dedicated',
  awsRegion: 'ap-south-1',
  mfaPolicy: 'OPTIONAL',
  createdAt: new Date(),
  updatedAt: new Date(),
} as const;

function saml(overrides: Record<string, unknown> = {}) {
  return {
    id: 'saml-1',
    tenantId: 'tenant-a',
    identityConnectionId: identityConnection.id,
    entityId: 'https://idp.example.test',
    metadataUrl: null,
    metadataReference: 'opaque-key',
    certificateFingerprints: ['AA'],
    certificateDetails: [],
    cognitoProviderName: 'EnterpriseIdp',
    attributeMapping: { email: 'email' },
    status: 'METADATA_VALID',
    metadataValidatedAt: new Date(),
    provisionedAt: null,
    testedAt: null,
    activatedAt: null,
    disabledAt: null,
    testResult: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    identityConnection,
    ...overrides,
  };
}

function service(
  prisma: PrismaService,
  send = jest.fn(),
): SamlConnectionsService {
  const validator = {
    validate: jest.fn((xml: string) => ({
      entityId: 'https://idp.example.test',
      certificates: [],
      fingerprints: [],
      xml,
    })),
  } as unknown as SamlMetadataValidator;
  const storage = {
    put: jest.fn(),
    get: jest.fn().mockResolvedValue('<metadata/>'),
  } as unknown as SamlMetadataStorage;
  return new SamlConnectionsService(
    prisma,
    validator,
    {} as SamlMetadataFetcher,
    storage,
    () => ({ send }) as unknown as CognitoAdminClient,
  );
}

function expectedReadinessSend(
  marker = ownershipMarker(),
): jest.Mock {
  return jest.fn(async (command: unknown) => {
    const name = (command as { constructor: { name: string } }).constructor
      .name;
    if (name === 'DescribeIdentityProviderCommand') {
      return {
        IdentityProvider: {
          ProviderName: 'EnterpriseIdp',
          ProviderType: 'SAML',
          ProviderDetails: {
            MetadataFile: '<metadata/>',
            IDPSignout: 'true',
          },
          AttributeMapping: { email: 'email' },
          IdpIdentifiers: [marker],
        },
      };
    }

    if (name === 'DescribeUserPoolClientCommand') {
      return {
        UserPoolClient: {
          ClientId: 'app-client',
          SupportedIdentityProviders: ['COGNITO', 'EnterpriseIdp'],
        },
      };
    }
    return {};
  });
}

function ownershipMarker(id = 'saml-1'): string {
  return `att-${createHash('sha256').update(id).digest('hex').slice(0, 32)}`;
}

describe('SamlConnectionsService', () => {
  afterEach(() => {
    delete process.env.IDENTITY_ADMIN_POOL_ARNS;
    delete process.env.SAML_SHARED_POOL_IDS;
  });

  it('applies the tenant to status queries and hides another tenant', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = {
      samlConnection: { findFirst },
    } as unknown as PrismaService;

    await expect(
      service(prisma).status('tenant-a', 'other-tenant-saml'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'other-tenant-saml', tenantId: 'tenant-a' },
      }),
    );
    expect(findFirst.mock.calls[0][0].select.metadataReference).toBeUndefined();
  });

  it('lists only this tenant dedicated connections and approved platform shared pools', async () => {
    process.env.SAML_SHARED_POOL_IDS = 'shared-approved, shared-second';
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      identityConnection: { findMany },
    } as unknown as PrismaService;

    await service(prisma).identityConnections('tenant-a');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { type: 'DEDICATED_COGNITO', tenantId: 'tenant-a' },
            {
              type: 'SHARED_COGNITO',
              tenantId: null,
              cognitoUserPoolId: {
                in: ['shared-approved', 'shared-second'],
              },
            },
          ],
        },
        select: {
          id: true,
          type: true,
          status: true,
          issuer: true,
          clientId: true,
          cognitoUserPoolId: true,
          awsRegion: true,
          mfaPolicy: true,
          discoverySlug: true,
          verifiedDomains: true,
        },
      }),
    );
  });

  it('activates a tested dedicated connection transactionally with tenant filters and audit', async () => {
    process.env.IDENTITY_ADMIN_POOL_ARNS =
      'arn:aws:cognito-idp:ap-south-1:123456789012:userpool/ap-south-1_dedicated';
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const transition = jest.fn().mockResolvedValue({ count: 1 });
    const reload = jest
      .fn()
      .mockResolvedValue({ id: 'saml-1', status: 'ACTIVE' });
    const audit = jest.fn().mockResolvedValue({});
    const prisma = {
      samlConnection: {
        findFirst: jest.fn().mockResolvedValue(
          saml({
            status: 'READY',
            testedAt: new Date(),
            testResult: {
              providerConfigured: true,
              providerEnabled: true,
            },
          }),
        ),
      },
      $transaction: jest.fn(async (
        callback: (tx: unknown) => unknown,
        options?: Record<string, unknown>,
      ) =>
        options
          ? callback({ $queryRaw: jest.fn().mockResolvedValue([]) })
          : callback({
              identityConnection: { updateMany },
              samlConnection: { updateMany: transition, findFirst: reload },
              auditEvent: { create: audit },
            }),
      ),
    } as unknown as PrismaService;

    await service(prisma, expectedReadinessSend()).activate(
      'tenant-a',
      'saml-1',
      'admin',
    );

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'identity-1',
          tenantId: 'tenant-a',
          type: 'DEDICATED_COGNITO',
        }),
        data: { status: 'ACTIVE' },
      }),
    );
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'saml-1',
          tenantId: 'tenant-a',
          status: 'READY',
          testedAt: expect.any(Date),
          metadataValidatedAt: expect.any(Date),
        }),
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-a',
          action: 'saml.activated',
        }),
      }),
    );
  });

  it('does not activate the dedicated connection when the READY snapshot is stale', async () => {
    process.env.IDENTITY_ADMIN_POOL_ARNS =
      'arn:aws:cognito-idp:ap-south-1:123456789012:userpool/ap-south-1_dedicated';
    const identityUpdate = jest.fn();
    const prisma = {
      samlConnection: {
        findFirst: jest.fn().mockResolvedValue(
          saml({
            status: 'READY',
            testedAt: new Date(),
            metadataValidatedAt: new Date(),
            testResult: {
              providerConfigured: true,
              providerEnabled: true,
            },
          }),
        ),
      },
      $transaction: jest.fn(async (
        callback: (tx: unknown) => unknown,
        options?: Record<string, unknown>,
      ) =>
        options
          ? callback({ $queryRaw: jest.fn().mockResolvedValue([]) })
          : callback({
              identityConnection: { updateMany: identityUpdate },
              samlConnection: {
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
              },
              auditEvent: { create: jest.fn() },
            }),
      ),
    } as unknown as PrismaService;

    await expect(
      service(prisma, expectedReadinessSend()).activate(
        'tenant-a',
        'saml-1',
        'admin',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(identityUpdate).not.toHaveBeenCalled();
  });

  it('rejects a foreign replacement provider during readiness testing without a success audit', async () => {
    const audit = jest.fn().mockResolvedValue({});
    const failureUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      samlConnection: {
        findFirst: jest.fn().mockResolvedValue(
          saml({ status: 'READY', provisionedAt: new Date() }),
        ),
      },
      $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
        callback({
          identityConnection: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          samlConnection: {
            updateMany: failureUpdate,
          },
          auditEvent: { create: audit },
        }),
      ),
    } as unknown as PrismaService;

    await expect(
      service(prisma, expectedReadinessSend('attendance-foreign')).test(
        'tenant-a',
        'saml-1',
        'admin',
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'saml.test_failed' }),
      }),
    );
    expect(audit).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'saml.test_succeeded' }),
      }),
    );
    expect(failureUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'READY',
          testedAt: null,
          metadataValidatedAt: expect.any(Date),
        }),
        data: expect.objectContaining({
          status: 'ERROR',
          testedAt: expect.any(Date),
          testResult: {
            providerConfigured: false,
            providerEnabled: false,
            finalAuthenticationConfirmed: false,
            message: expect.any(String),
          },
        }),
      }),
    );
  });

  it('records a raced READY test failure on the newly ACTIVE row without disabling discovery', async () => {
    const priorTestedAt = new Date('2026-08-26T10:00:00Z');
    const metadataValidatedAt = new Date('2026-08-26T09:00:00Z');
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    const identityUpdate = jest.fn();
    const audit = jest.fn().mockResolvedValue({});
    const prisma = {
      samlConnection: {
        findFirst: jest.fn().mockResolvedValue(
          saml({
            status: 'READY',
            testedAt: priorTestedAt,
            metadataValidatedAt,
          }),
        ),
      },
      $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
        callback({
          identityConnection: { updateMany: identityUpdate },
          samlConnection: {
            updateMany,
            findFirst: jest.fn().mockResolvedValue({ status: 'ACTIVE' }),
          },
          auditEvent: { create: audit },
        }),
      ),
    } as unknown as PrismaService;

    await expect(
      service(prisma, expectedReadinessSend('att-foreign')).test(
        'tenant-a',
        'saml-1',
        'admin',
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'READY',
          testedAt: priorTestedAt,
          metadataValidatedAt,
        }),
      }),
    );
    expect(updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'saml-1', tenantId: 'tenant-a', status: 'ACTIVE' },
        data: expect.objectContaining({
          testedAt: expect.any(Date),
          testResult: expect.objectContaining({
            providerConfigured: false,
            providerEnabled: false,
            finalAuthenticationConfirmed: false,
          }),
        }),
      }),
    );
    expect(identityUpdate).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'saml.active_test_failed' }),
      }),
    );
  });

  it('audits and discards a stale READY test failure after metadata changed', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const audit = jest.fn().mockResolvedValue({});
    const prisma = {
      samlConnection: {
        findFirst: jest.fn().mockResolvedValue(
          saml({ status: 'READY', testedAt: new Date() }),
        ),
      },
      $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
        callback({
          identityConnection: { updateMany: jest.fn() },
          samlConnection: {
            updateMany,
            findFirst: jest
              .fn()
              .mockResolvedValue({ status: 'METADATA_VALID' }),
          },
          auditEvent: { create: audit },
        }),
      ),
    } as unknown as PrismaService;

    await expect(
      service(prisma, expectedReadinessSend('att-foreign')).test(
        'tenant-a',
        'saml-1',
        'admin',
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'saml.stale_test_failure_discarded',
          metadata: expect.objectContaining({
            observedStatus: 'METADATA_VALID',
          }),
        }),
      }),
    );
  });

  it('rechecks ownership and expected provider state before activation', async () => {
    process.env.IDENTITY_ADMIN_POOL_ARNS =
      'arn:aws:cognito-idp:ap-south-1:123456789012:userpool/ap-south-1_dedicated';
    const transition = jest.fn();
    const audit = jest.fn();
    const prisma = {
      samlConnection: {
        findFirst: jest.fn().mockResolvedValue(
          saml({
            status: 'READY',
            testedAt: new Date(),
            metadataValidatedAt: new Date(),
            testResult: {
              providerConfigured: true,
              providerEnabled: true,
            },
          }),
        ),
      },
      $transaction: jest.fn(
        async (
          callback: (tx: unknown) => unknown,
          options?: Record<string, unknown>,
        ) =>
          options
            ? callback({ $queryRaw: jest.fn().mockResolvedValue([]) })
            : callback({
                identityConnection: { updateMany: jest.fn() },
                samlConnection: { updateMany: transition },
                auditEvent: { create: audit },
              }),
      ),
    } as unknown as PrismaService;

    await expect(
      service(
        prisma,
        expectedReadinessSend('attendance-replacement'),
      ).activate('tenant-a', 'saml-1', 'admin'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transition).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it('deletes a newly created IdP when app-client enablement fails and records ERROR', async () => {
    const statusUpdate = jest.fn().mockResolvedValue({});
    const failureUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const audit = jest.fn().mockResolvedValue({});
    const prisma = {
      samlConnection: {
        findFirst: jest.fn().mockResolvedValue(saml()),
      },
      $transaction: jest.fn(async (
        callback: (tx: unknown) => unknown,
        options?: Record<string, unknown>,
      ) =>
        options
          ? callback({ $queryRaw: jest.fn().mockResolvedValue([]) })
          : callback({
          identityConnection: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          samlConnection: {
            update: statusUpdate,
            updateMany: failureUpdate,
          },
          auditEvent: { create: audit },
        }),
      ),
    } as unknown as PrismaService;
    let providerExists = false;
    let providerIdentifiers: string[] = [];
    const send = jest.fn(async (command: unknown) => {
      const name = (command as { constructor: { name: string } }).constructor
        .name;
      if (name === 'DescribeIdentityProviderCommand') {
        if (!providerExists) {
          throw Object.assign(new Error('missing'), {
            name: 'ResourceNotFoundException',
          });
        }
        return {
          IdentityProvider: {
            ProviderName: 'EnterpriseIdp',
            ProviderType: 'SAML',
            IdpIdentifiers: [...providerIdentifiers],
          },
        };
      }
      if (name === 'CreateIdentityProviderCommand') {
        providerExists = true;
        providerIdentifiers = [
          ...((command as { input: { IdpIdentifiers?: string[] } }).input
            .IdpIdentifiers ?? []),
        ];
      }
      if (name === 'DeleteIdentityProviderCommand') {
        providerExists = false;
      }
      if (name === 'DescribeUserPoolClientCommand') {
        return {
          UserPoolClient: {
            ClientId: 'app-client',
            SupportedIdentityProviders: ['COGNITO'],
          },
        };
      }
      if (command instanceof UpdateUserPoolClientCommand) {
        throw Object.assign(new Error('client update denied'), {
          name: 'AccessDeniedException',
        });
      }
      return {};
    });

    await expect(
      service(prisma, send).provision('tenant-a', 'saml-1', 'admin'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(
      send.mock.calls.some(([command]) => command instanceof DeleteIdentityProviderCommand),
    ).toBe(true);
    const createCommand = send.mock.calls
      .map(([command]) => command)
      .find(
        (command) =>
          (command as { constructor: { name: string } }).constructor.name ===
          'CreateIdentityProviderCommand',
      ) as { input: { IdpIdentifiers?: string[] } };
    const marker = createCommand.input.IdpIdentifiers?.[0];
    expect(marker).toBe(ownershipMarker());
    expect(marker).toHaveLength(36);
    expect(marker!.length).toBeLessThanOrEqual(40);
    expect(failureUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'saml-1', tenantId: 'tenant-a' },
        data: expect.objectContaining({
          status: 'ERROR',
          lastErrorCode: 'AccessDeniedException',
        }),
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'saml.provision_failed' }),
      }),
    );
  });

  it('rejects changing the provider name while redrafting an existing configuration', async () => {
    const prisma = {
      identityConnection: {
        findFirst: jest.fn().mockResolvedValue(identityConnection),
      },
      samlConnection: {
        findFirst: jest.fn().mockResolvedValue(
          saml({ status: 'ERROR', cognitoProviderName: 'ExistingIdp' }),
        ),
      },
    } as unknown as PrismaService;

    await expect(
      service(prisma).createDraft('tenant-a', 'admin', {
        identityConnectionId: 'identity-1',
        cognitoProviderName: 'RenamedIdp',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it.each(['COGNITO', 'facebook', 'GoOgLe', 'loginwithamazon', 'SIGNINWITHAPPLE'])(
    'rejects reserved built-in provider name %s case-insensitively',
    async (providerName) => {
      const prisma = {
        identityConnection: { findFirst: jest.fn() },
      } as unknown as PrismaService;

      await expect(
        service(prisma).createDraft('tenant-a', 'admin', {
          identityConnectionId: 'identity-1',
          cognitoProviderName: providerName,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('rejects a foreign provider collision without mutating Cognito', async () => {
    const audit = jest.fn().mockResolvedValue({});
    const prisma = {
      samlConnection: {
        findFirst: jest.fn().mockResolvedValue(
          saml({ status: 'PROVISIONING' }),
        ),
      },
      $transaction: jest.fn(
        async (
          callback: (tx: unknown) => unknown,
          options?: Record<string, unknown>,
        ) =>
          options
            ? callback({ $queryRaw: jest.fn().mockResolvedValue([]) })
            : callback({
                samlConnection: {
                  updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                },
                auditEvent: { create: audit },
              }),
      ),
    } as unknown as PrismaService;
    const send = jest.fn(async (command: unknown) => {
      const name = (command as { constructor: { name: string } }).constructor
        .name;
      if (name === 'DescribeIdentityProviderCommand') {
        return {
          IdentityProvider: {
            ProviderName: 'EnterpriseIdp',
            ProviderType: 'SAML',
            IdpIdentifiers: ['attendance-another-connection'],
          },
        };
      }
      throw new Error(`Unexpected Cognito mutation ${name}`);
    });

    await expect(
      service(prisma, send).provision('tenant-a', 'saml-1', 'admin'),
    ).rejects.toThrow('foreign Cognito provider');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not delete a concurrently-created foreign provider during recovery', async () => {
    const events: string[] = [];
    let describeCount = 0;
    let providers = ['COGNITO'];
    const prisma = {
      samlConnection: {
        findFirst: jest.fn().mockResolvedValue(
          saml({ status: 'PROVISIONING' }),
        ),
      },
      $transaction: jest.fn(
        async (
          callback: (tx: unknown) => unknown,
          options?: Record<string, unknown>,
        ) =>
          options
            ? callback({
                $queryRaw: jest.fn().mockImplementation(async () => {
                  events.push('lock');
                  return [];
                }),
              })
            : callback({
                samlConnection: {
                  updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                },
                auditEvent: { create: jest.fn().mockResolvedValue({}) },
              }),
      ),
    } as unknown as PrismaService;
    const send = jest.fn(async (command: unknown) => {
      const name = (command as { constructor: { name: string } }).constructor
        .name;
      events.push(name);
      if (name === 'DescribeIdentityProviderCommand') {
        describeCount += 1;
        if (describeCount === 1) {
          throw Object.assign(new Error('missing'), {
            name: 'ResourceNotFoundException',
          });
        }
        return {
          IdentityProvider: {
            ProviderName: 'EnterpriseIdp',
            ProviderType: 'SAML',
            IdpIdentifiers: ['attendance-concurrent-owner'],
          },
        };
      }
      if (name === 'DescribeUserPoolClientCommand') {
        return {
          UserPoolClient: {
            ClientId: 'app-client',
            SupportedIdentityProviders: [...providers],
          },
        };
      }
      if (name === 'CreateIdentityProviderCommand') {
        providers = ['COGNITO', 'EnterpriseIdp'];
        throw Object.assign(new Error('provider appeared concurrently'), {
          name: 'DuplicateProviderException',
        });
      }
      return {};
    });

    await expect(
      service(prisma, send).provision('tenant-a', 'saml-1', 'admin'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(events[0]).toBe('lock');
    expect(
      send.mock.calls.some(
        ([command]) => command instanceof DeleteIdentityProviderCommand,
      ),
    ).toBe(false);
    expect(
      send.mock.calls.some(
        ([command]) => command instanceof UpdateUserPoolClientCommand,
      ),
    ).toBe(false);
    expect(providers).toEqual(['COGNITO', 'EnterpriseIdp']);
  });

  it('prevents DRAFT and foreign configurations from disabling app-client providers', async () => {
    const draftPrisma = {
      samlConnection: {
        findFirst: jest.fn().mockResolvedValue(saml({ status: 'DRAFT' })),
      },
    } as unknown as PrismaService;
    await expect(
      service(draftPrisma).disable('tenant-a', 'saml-1', 'admin'),
    ).rejects.toBeInstanceOf(ConflictException);

    const activeFailure = jest.fn().mockResolvedValue({ count: 1 });
    const foreignPrisma = {
      samlConnection: {
        findFirst: jest.fn().mockResolvedValue(
          saml({ status: 'ACTIVE', provisionedAt: new Date() }),
        ),
      },
      $transaction: jest.fn(
        async (
          callback: (tx: unknown) => unknown,
          options?: Record<string, unknown>,
        ) =>
          options
            ? callback({ $queryRaw: jest.fn().mockResolvedValue([]) })
            : callback({
                samlConnection: { updateMany: activeFailure },
                auditEvent: { create: jest.fn().mockResolvedValue({}) },
              }),
      ),
    } as unknown as PrismaService;
    const send = jest.fn().mockResolvedValue({
      IdentityProvider: {
        ProviderName: 'EnterpriseIdp',
        ProviderType: 'SAML',
        IdpIdentifiers: ['attendance-foreign'],
      },
    });
    await expect(
      service(foreignPrisma, send).disable('tenant-a', 'saml-1', 'admin'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('preserves ACTIVE routing when an AWS readiness re-test fails', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const identityUpdate = jest.fn();
    const audit = jest.fn().mockResolvedValue({});
    const prisma = {
      samlConnection: {
        findFirst: jest.fn().mockResolvedValue(saml({ status: 'ACTIVE' })),
      },
      $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
        callback({
          samlConnection: { updateMany },
          identityConnection: { updateMany: identityUpdate },
          auditEvent: { create: audit },
        }),
      ),
    } as unknown as PrismaService;
    const send = jest.fn().mockRejectedValue(
      Object.assign(new Error('temporary Cognito outage'), {
        name: 'TimeoutError',
      }),
    );

    await expect(
      service(prisma, send).test('tenant-a', 'saml-1', 'admin'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'saml-1', tenantId: 'tenant-a', status: 'ACTIVE' },
        data: expect.not.objectContaining({ status: expect.anything() }),
      }),
    );
    expect(identityUpdate).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'saml.active_test_failed',
          metadata: expect.objectContaining({
            finalAuthenticationConfirmed: false,
          }),
        }),
      }),
    );
  });

  it('restores the dedicated app client and preserves ACTIVE discovery when disable DB finalization fails', async () => {
    let providers = ['COGNITO', 'EnterpriseIdp'];
    let transactionCount = 0;
    const activeFailureUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const activeFailureAudit = jest.fn().mockResolvedValue({});
    const prisma = {
      samlConnection: {
        findFirst: jest.fn().mockResolvedValue(
          saml({ status: 'ACTIVE', provisionedAt: new Date() }),
        ),
      },
      $transaction: jest.fn(async (
        callback: (tx: unknown) => unknown,
        options?: Record<string, unknown>,
      ) => {
        if (options) {
          return callback({ $queryRaw: jest.fn().mockResolvedValue([]) });
        }
        transactionCount += 1;
        if (transactionCount === 1) {
          return callback({
            identityConnection: {
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            samlConnection: {
              update: jest.fn().mockResolvedValue({ status: 'DISABLED' }),
            },
            auditEvent: {
              create: jest
                .fn()
                .mockRejectedValue(new Error('database commit failed')),
            },
          });
        }
        return callback({
          samlConnection: { updateMany: activeFailureUpdate },
          auditEvent: { create: activeFailureAudit },
        });
      }),
    } as unknown as PrismaService;
    const send = jest.fn(async (command: unknown) => {
      const name = (command as { constructor: { name: string } }).constructor
        .name;
      if (name === 'DescribeIdentityProviderCommand') {
        return {
          IdentityProvider: {
            ProviderName: 'EnterpriseIdp',
            ProviderType: 'SAML',
            IdpIdentifiers: [ownershipMarker()],
          },
        };
      }
      if (name === 'DescribeUserPoolClientCommand') {
        return {
          UserPoolClient: {
            ClientId: 'app-client',
            SupportedIdentityProviders: [...providers],
          },
        };
      }
      if (name === 'UpdateUserPoolClientCommand') {
        providers = [
          ...((command as { input: { SupportedIdentityProviders?: string[] } })
            .input.SupportedIdentityProviders ?? []),
        ];
      }
      return {};
    });

    await expect(
      service(prisma, send).disable('tenant-a', 'saml-1', 'admin'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(providers).toEqual(['COGNITO', 'EnterpriseIdp']);
    expect(
      send.mock.calls.filter(
        ([command]) => command instanceof UpdateUserPoolClientCommand,
      ),
    ).toHaveLength(2);
    expect(activeFailureUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'saml-1', tenantId: 'tenant-a', status: 'ACTIVE' },
        data: expect.not.objectContaining({ status: expect.anything() }),
      }),
    );
    expect(activeFailureAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'saml.active_disable_failed',
          metadata: expect.objectContaining({ appClientRestored: true }),
        }),
      }),
    );
  });

  it('rolls back provider and app-client changes when DB finalization fails', async () => {
    let providerExists = false;
    let providerIdentifiers: string[] = [];
    let supportedProviders = ['COGNITO'];
    let transactionCount = 0;
    const failureUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      samlConnection: {
        findFirst: jest.fn().mockResolvedValue(saml()),
      },
      $transaction: jest.fn(async (
        callback: (tx: unknown) => unknown,
        options?: Record<string, unknown>,
      ) => {
        if (options) {
          return callback({ $queryRaw: jest.fn().mockResolvedValue([]) });
        }
        transactionCount += 1;
        if (transactionCount === 1) {
          return callback({
            identityConnection: {
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            samlConnection: { update: jest.fn().mockResolvedValue({}) },
            auditEvent: { create: jest.fn().mockResolvedValue({}) },
          });
        }
        if (transactionCount === 2) {
          return callback({
            samlConnection: {
              update: jest.fn().mockResolvedValue({ status: 'READY' }),
            },
            auditEvent: {
              create: jest.fn().mockRejectedValue(new Error('database down')),
            },
          });
        }
        return callback({
          identityConnection: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          samlConnection: { updateMany: failureUpdate },
          auditEvent: { create: jest.fn().mockResolvedValue({}) },
        });
      }),
    } as unknown as PrismaService;
    const send = jest.fn(async (command: unknown) => {
      const name = (command as { constructor: { name: string } }).constructor
        .name;
      if (name === 'DescribeIdentityProviderCommand') {
        if (!providerExists) {
          throw Object.assign(new Error('missing'), {
            name: 'ResourceNotFoundException',
          });
        }
        return {
          IdentityProvider: {
            ProviderName: 'EnterpriseIdp',
            ProviderType: 'SAML',
            IdpIdentifiers: [...providerIdentifiers],
          },
        };
      }
      if (name === 'CreateIdentityProviderCommand') {
        providerExists = true;
        providerIdentifiers = [
          ...((command as { input: { IdpIdentifiers?: string[] } }).input
            .IdpIdentifiers ?? []),
        ];
      }
      if (name === 'DeleteIdentityProviderCommand') {
        providerExists = false;
      }
      if (name === 'DescribeUserPoolClientCommand') {
        return {
          UserPoolClient: {
            ClientId: 'app-client',
            SupportedIdentityProviders: [...supportedProviders],
          },
        };
      }
      if (name === 'UpdateUserPoolClientCommand') {
        supportedProviders = [
          ...((command as { input: { SupportedIdentityProviders?: string[] } })
            .input.SupportedIdentityProviders ?? []),
        ];
      }
      return {};
    });

    await expect(
      service(prisma, send).provision('tenant-a', 'saml-1', 'admin'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(providerExists).toBe(false);
    expect(supportedProviders).toEqual(['COGNITO']);
    expect(failureUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ERROR' }),
      }),
    );
  });

  it('resumes PROVISIONING idempotently with the deterministic ownership marker', async () => {
    const update = jest.fn().mockResolvedValue({ status: 'READY' });
    const prisma = {
      samlConnection: {
        findFirst: jest.fn().mockResolvedValue(
          saml({ status: 'PROVISIONING' }),
        ),
      },
      $transaction: jest.fn(async (
        callback: (tx: unknown) => unknown,
        options?: Record<string, unknown>,
      ) =>
        options
          ? callback({ $queryRaw: jest.fn().mockResolvedValue([]) })
          : callback({
              samlConnection: { update },
              auditEvent: { create: jest.fn().mockResolvedValue({}) },
            }),
      ),
    } as unknown as PrismaService;
    const send = jest.fn(async (command: unknown) => {
      const name = (command as { constructor: { name: string } }).constructor
        .name;
      if (name === 'DescribeIdentityProviderCommand') {
        return {
          IdentityProvider: {
            ProviderName: 'EnterpriseIdp',
            ProviderType: 'SAML',
            ProviderDetails: {
              MetadataFile: '<metadata/>',
              IDPSignout: 'true',
            },
            AttributeMapping: { email: 'email' },
            IdpIdentifiers: [ownershipMarker()],
          },
        };
      }
      if (name === 'DescribeUserPoolClientCommand') {
        return {
          UserPoolClient: {
            ClientId: 'app-client',
            SupportedIdentityProviders: ['COGNITO', 'EnterpriseIdp'],
          },
        };
      }
      throw new Error(`Unexpected mutation command ${name}`);
    });

    await expect(
      service(prisma, send).provision('tenant-a', 'saml-1', 'admin'),
    ).resolves.toEqual({ status: 'READY' });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('acquires a PostgreSQL advisory lock before shared app-client mutation and verifies the update', async () => {
    process.env.SAML_SHARED_POOL_IDS = 'shared-pool';
    const events: string[] = [];
    let providers = ['COGNITO', 'EnterpriseIdp'];
    const sharedIdentity = {
      ...identityConnection,
      id: 'shared-identity',
      tenantId: null,
      type: 'SHARED_COGNITO',
      cognitoUserPoolId: 'shared-pool',
    } as const;
    const prisma = {
      samlConnection: {
        findFirst: jest.fn().mockResolvedValue(
          saml({
            status: 'ACTIVE',
            provisionedAt: new Date(),
            identityConnectionId: 'shared-identity',
            identityConnection: sharedIdentity,
          }),
        ),
      },
      $transaction: jest.fn(
        async (
          callback: (tx: unknown) => unknown,
          options?: Record<string, unknown>,
        ) => {
          if (options) {
            return callback({
              $queryRaw: jest.fn().mockImplementation(async () => {
                events.push('lock');
                return [];
              }),
            });
          }
          return callback({
            samlConnection: {
              update: jest.fn().mockResolvedValue({ status: 'DISABLED' }),
            },
            auditEvent: { create: jest.fn().mockResolvedValue({}) },
          });
        },
      ),
    } as unknown as PrismaService;
    const send = jest.fn(async (command: unknown) => {
      const name = (command as { constructor: { name: string } }).constructor
        .name;
      events.push(name);
      if (name === 'DescribeIdentityProviderCommand') {
        return {
          IdentityProvider: {
            ProviderName: 'EnterpriseIdp',
            ProviderType: 'SAML',
            IdpIdentifiers: [ownershipMarker()],
          },
        };
      }
      if (name === 'DescribeUserPoolClientCommand') {
        return {
          UserPoolClient: {
            ClientId: 'app-client',
            SupportedIdentityProviders: [...providers],
          },
        };
      }
      if (name === 'UpdateUserPoolClientCommand') {
        providers = [
          ...((command as { input: { SupportedIdentityProviders?: string[] } })
            .input.SupportedIdentityProviders ?? []),
        ];
      }
      return {};
    });

    await service(prisma, send).disable('tenant-a', 'saml-1', 'admin');

    expect(events[0]).toBe('lock');
    expect(events.filter((event) => event === 'DescribeUserPoolClientCommand')).toHaveLength(2);
    expect(providers).toEqual(['COGNITO']);
  });
});
