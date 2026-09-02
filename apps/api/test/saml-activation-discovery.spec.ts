import { PrismaService } from '../src/prisma/prisma.service';
import { createHash } from 'crypto';
import { IdentityDiscoveryService } from '../src/auth/identity-discovery.service';
import { SamlConnectionsService } from '../src/saml-connections/saml-connections.service';
import {
  SamlMetadataFetcher,
  SamlMetadataValidator,
  type SamlMetadataStorage,
} from '../src/saml-connections/saml-metadata';

const sharedLogin = {
  issuer: 'https://issuer.example/shared',
  clientId: 'shared-client',
  authorizationEndpoint: 'https://shared.example/oauth2/authorize',
  tokenEndpoint: 'https://shared.example/oauth2/token',
  endSessionEndpoint: 'https://shared.example/logout',
  scopes: ['openid', 'email', 'profile'],
};

const dedicatedLogin = {
  issuer:
    'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_enterprise',
  clientId: 'dedicated-client',
  authorizationEndpoint: 'https://enterprise.example/oauth2/authorize',
  tokenEndpoint: 'https://enterprise.example/oauth2/token',
  endSessionEndpoint: 'https://enterprise.example/logout',
  scopes: ['openid', 'email', 'profile'],
};

describe('SAML activation and identity discovery contract', () => {
  afterEach(() => {
    delete process.env.IDENTITY_ADMIN_POOL_ARNS;
  });

  it('selects an activated dedicated connection by normalized slug/domain while unknown inputs retain the identical safe shared fallback', async () => {
    process.env.IDENTITY_ADMIN_POOL_ARNS =
      'arn:aws:cognito-idp:ap-south-1:123456789012:userpool/ap-south-1_enterprise';
    const dedicated = {
      id: 'identity-dedicated',
      tenantId: 'tenant-a',
      type: 'DEDICATED_COGNITO',
      status: 'DISABLED',
      ...dedicatedLogin,
      discoverySlug: 'enterprise',
      verifiedDomains: ['enterprise.example'],
      isDefault: false,
      clientSecretReference: null,
      cognitoUserPoolId: 'ap-south-1_enterprise',
      awsRegion: 'ap-south-1',
      mfaPolicy: 'OPTIONAL',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const saml = {
      id: 'saml-1',
      tenantId: 'tenant-a',
      identityConnectionId: dedicated.id,
      entityId: 'https://idp.enterprise.example',
      metadataUrl: null,
      metadataReference: 'opaque-reference',
      certificateFingerprints: ['AA'],
      certificateDetails: [],
      cognitoProviderName: 'EnterpriseIdp',
      attributeMapping: { email: 'email' },
      status: 'READY',
      metadataValidatedAt: new Date(),
      provisionedAt: new Date(),
      testedAt: new Date(),
      activatedAt: null,
      disabledAt: null,
      testResult: {
        providerConfigured: true,
        providerEnabled: true,
        finalAuthenticationConfirmed: false,
      },
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      identityConnection: dedicated,
    };
    const identityFindFirst = jest.fn(
      async (query: {
        where: {
          type: string;
          OR?: Array<
            | { discoverySlug: string }
            | { verifiedDomains: { has: string } }
          >;
        };
      }) => {
        if (query.where.type === 'DEDICATED_COGNITO') {
          const matches = query.where.OR?.some((condition) =>
            'discoverySlug' in condition
              ? condition.discoverySlug === dedicated.discoverySlug
              : condition.verifiedDomains.has ===
                dedicated.verifiedDomains[0],
          );
          return dedicated.status === 'ACTIVE' && matches
            ? dedicatedLogin
            : null;
        }
        return sharedLogin;
      },
    );
    const prisma = {
      samlConnection: {
        findFirst: jest.fn().mockResolvedValue(saml),
      },
      identityConnection: {
        findFirst: identityFindFirst,
      },
      $transaction: jest.fn(async (
        callback: (tx: unknown) => unknown,
        options?: Record<string, unknown>,
      ) =>
        options
          ? callback({ $queryRaw: jest.fn().mockResolvedValue([]) })
          : callback({
          identityConnection: {
            updateMany: jest.fn().mockImplementation(async () => {
              dedicated.status = 'ACTIVE';
              return { count: 1 };
            }),
          },
          samlConnection: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findFirst: jest.fn().mockResolvedValue({
              id: saml.id,
              status: 'ACTIVE',
            }),
          },
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
            IdpIdentifiers: [
              `att-${createHash('sha256')
                .update('saml-1')
                .digest('hex')
                .slice(0, 32)}`,
            ],
          },
        };
      }
      return {
        UserPoolClient: {
          ClientId: 'dedicated-client',
          SupportedIdentityProviders: ['COGNITO', 'EnterpriseIdp'],
        },
      };
    });
    const samlService = new SamlConnectionsService(
      prisma,
      {} as SamlMetadataValidator,
      {} as SamlMetadataFetcher,
      { get: jest.fn().mockResolvedValue('<metadata/>') } as unknown as SamlMetadataStorage,
      () => ({ send }) as never,
    );

    await samlService.activate('tenant-a', saml.id, 'admin-subject');
    expect(dedicated.status).toBe('ACTIVE');

    const discovery = new IdentityDiscoveryService(prisma);
    await expect(discovery.discover('  ENTERPRISE  ')).resolves.toEqual(
      dedicatedLogin,
    );
    await expect(discovery.discover('Enterprise.Example')).resolves.toEqual(
      dedicatedLogin,
    );

    const unknown = await discovery.discover('unknown.example');
    const standard = await discovery.discover('standard-tenant');
    expect(unknown).toEqual(sharedLogin);
    expect(standard).toEqual(unknown);
    for (const result of [unknown, standard]) {
      expect(result).not.toHaveProperty('tenantId');
      expect(result).not.toHaveProperty('id');
      expect(result).not.toHaveProperty('type');
      expect(result).not.toHaveProperty('status');
    }
  });
});
