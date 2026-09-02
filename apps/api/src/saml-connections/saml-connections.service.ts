import {
  CreateIdentityProviderCommand,
  DeleteIdentityProviderCommand,
  DescribeIdentityProviderCommand,
  DescribeUserPoolClientCommand,
  UpdateIdentityProviderCommand,
  UpdateUserPoolClientCommand,
  type IdentityProviderType,
  type UserPoolClientType,
  type UpdateUserPoolClientCommandInput,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  IdentityConnectionType,
  Prisma,
  SamlConnectionStatus,
} from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  COGNITO_ADMIN_CLIENT_FACTORY,
  createCognitoAdminClient,
  type CognitoAdminClient,
  type CognitoAdminClientFactory,
} from '../tenant-users/cognito-admin';
import { CreateSamlConnectionDto } from './dto/create-saml-connection.dto';
import { UpdateSamlMetadataDto } from './dto/update-saml-metadata.dto';
import {
  SAML_METADATA_STORAGE,
  type SamlMetadataStorage,
  SamlMetadataFetcher,
  SamlMetadataValidator,
} from './saml-metadata';

const PUBLIC_SELECT = {
  id: true,
  identityConnectionId: true,
  entityId: true,
  metadataUrl: true,
  certificateFingerprints: true,
  certificateDetails: true,
  cognitoProviderName: true,
  attributeMapping: true,
  status: true,
  metadataValidatedAt: true,
  provisionedAt: true,
  testedAt: true,
  activatedAt: true,
  disabledAt: true,
  testResult: true,
  lastErrorCode: true,
  lastErrorMessage: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SamlConnectionSelect;

type SamlWithConnection = Prisma.SamlConnectionGetPayload<{
  include: { identityConnection: true };
}>;

interface ProvisioningSnapshot {
  provider: IdentityProviderType | undefined;
  appClient: UserPoolClientType;
  appProviders: string[];
  providerCreated: boolean;
  providerUpdated: boolean;
  appClientMutationAttempted: boolean;
  appClientUpdated: boolean;
}

const BUILT_IN_COGNITO_PROVIDERS = new Set(
  [
    'COGNITO',
    'Facebook',
    'Google',
    'LoginWithAmazon',
    'SignInWithApple',
  ].map((name) => name.toLowerCase()),
);

@Injectable()
export class SamlConnectionsService {
  private readonly clients = new Map<string, CognitoAdminClient>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly validator: SamlMetadataValidator,
    private readonly fetcher: SamlMetadataFetcher,
    @Inject(SAML_METADATA_STORAGE)
    private readonly storage: SamlMetadataStorage,
    @Optional()
    @Inject(COGNITO_ADMIN_CLIENT_FACTORY)
    private readonly clientFactory: CognitoAdminClientFactory =
      createCognitoAdminClient,
  ) {}

  list(tenantId: string) {
    return this.prisma.samlConnection.findMany({
      where: { tenantId },
      select: PUBLIC_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  identityConnections(tenantId: string) {
    const approvedSharedPools = environmentList('SAML_SHARED_POOL_IDS');
    return this.prisma.identityConnection.findMany({
      where: {
        OR: [
          { type: 'DEDICATED_COGNITO', tenantId },
          {
            type: 'SHARED_COGNITO',
            tenantId: null,
            cognitoUserPoolId: { in: approvedSharedPools },
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
      orderBy: [{ type: 'asc' }, { issuer: 'asc' }],
    });
  }

  async status(tenantId: string, id: string) {
    const connection = await this.prisma.samlConnection.findFirst({
      where: { id, tenantId },
      select: PUBLIC_SELECT,
    });
    if (!connection) throw new NotFoundException('SAML connection not found');
    return connection;
  }

  async createDraft(
    tenantId: string,
    actorSubject: string,
    input: CreateSamlConnectionDto,
  ) {
    assertCustomProviderName(input.cognitoProviderName);
    const identityConnection = await this.prisma.identityConnection.findFirst({
      where: {
        id: input.identityConnectionId,
        OR: [
          { type: 'DEDICATED_COGNITO', tenantId },
          { type: 'SHARED_COGNITO', tenantId: null },
        ],
      },
    });
    if (!identityConnection) {
      throw new BadRequestException(
        'An eligible IdentityConnection is required before SAML onboarding',
      );
    }
    this.assertConnectionEligible(identityConnection.type, identityConnection.tenantId, tenantId);
    if (identityConnection.type === 'SHARED_COGNITO') {
      this.assertSharedPoolApproved(identityConnection.cognitoUserPoolId);
    }
    const attributeMapping = safeAttributeMapping(input.attributeMapping);
    const existing = await this.prisma.samlConnection.findFirst({
      where: {
        tenantId,
        identityConnectionId: identityConnection.id,
      },
    });
    if (
      existing &&
      !['DRAFT', 'ERROR', 'DISABLED'].includes(existing.status)
    ) {
      throw new ConflictException(
        'Provisioned SAML configuration cannot be changed as a draft',
      );
    }
    if (
      existing &&
      existing.cognitoProviderName !== input.cognitoProviderName
    ) {
      throw new ConflictException(
        'Cognito provider name cannot change until the existing provider is cleaned up',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const result = existing
        ? await tx.samlConnection.update({
          where: { id: existing.id, tenantId },
            data: {
              cognitoProviderName: input.cognitoProviderName,
              attributeMapping,
              status: 'DRAFT',
              provisionedAt: null,
              testedAt: null,
              activatedAt: null,
              testResult: Prisma.DbNull,
              lastErrorCode: null,
              lastErrorMessage: null,
            },
            select: PUBLIC_SELECT,
          })
        : await tx.samlConnection.create({
            data: {
              tenantId,
              identityConnectionId: identityConnection.id,
              cognitoProviderName: input.cognitoProviderName,
              attributeMapping,
            },
            select: PUBLIC_SELECT,
          });
      await this.audit(
        tx,
        tenantId,
        actorSubject,
        existing ? 'saml.draft_updated' : 'saml.draft_created',
        result.id,
        {
          identityConnectionId: identityConnection.id,
          cognitoProviderName: input.cognitoProviderName,
        },
      );
      return result;
    });
  }

  async updateMetadata(
    tenantId: string,
    id: string,
    actorSubject: string,
    input: UpdateSamlMetadataDto,
  ) {
    if (!!input.metadataUrl === !!input.metadataXml) {
      throw new BadRequestException(
        'Provide exactly one of metadataUrl or metadataXml',
      );
    }
    const connection = await this.connection(tenantId, id);
    if (
      connection.status === 'PROVISIONING' ||
      connection.status === 'ACTIVE'
    ) {
      throw new ConflictException(
        'Active or provisioning SAML metadata cannot be replaced',
      );
    }
    const xml = input.metadataUrl
      ? await this.fetcher.fetch(input.metadataUrl)
      : input.metadataXml!;
    const metadata = this.validator.validate(xml);
    const reference = await this.storage.put(tenantId, id, metadata.xml);
    return this.prisma.$transaction(async (tx) => {
      const transition = await tx.samlConnection.updateMany({
        where: {
          id: connection.id,
          tenantId,
          status: connection.status,
          updatedAt: connection.updatedAt,
        },
        data: {
          entityId: metadata.entityId,
          metadataUrl: input.metadataUrl ?? null,
          metadataReference: reference,
          certificateFingerprints: metadata.fingerprints,
          certificateDetails:
            metadata.certificates as unknown as Prisma.InputJsonValue,
          status: 'METADATA_VALID',
          metadataValidatedAt: new Date(),
          provisionedAt: null,
          testedAt: null,
          activatedAt: null,
          testResult: Prisma.DbNull,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      if (transition.count !== 1) {
        throw new ConflictException(
          'SAML configuration changed while metadata was being validated',
        );
      }
      const result = await tx.samlConnection.findFirst({
        where: { id: connection.id, tenantId, status: 'METADATA_VALID' },
        select: PUBLIC_SELECT,
      });
      if (!result) {
        throw new ConflictException(
          'Validated SAML configuration could not be reloaded',
        );
      }
      await this.audit(
        tx,
        tenantId,
        actorSubject,
        'saml.metadata_validated',
        id,
        {
          entityId: metadata.entityId,
          metadataReference: reference,
          fingerprints: metadata.fingerprints,
          source: input.metadataUrl ? 'url' : 'upload',
        },
      );
      return result;
    });
  }

  async provision(tenantId: string, id: string, actorSubject: string) {
    const connection = await this.connection(tenantId, id);
    if (connection.status === 'ACTIVE') return this.status(tenantId, id);
    if (
      !connection.metadataReference ||
      !connection.entityId ||
      !['METADATA_VALID', 'READY', 'ERROR', 'PROVISIONING'].includes(
        connection.status,
      )
    ) {
      throw new ConflictException(
        'Validated metadata is required before provisioning',
      );
    }
    if (connection.status !== 'PROVISIONING') {
      await this.setStatusAndAudit(
        tenantId,
        actorSubject,
        connection,
        'PROVISIONING',
        'saml.provisioning_started',
      );
    }

    const client = this.client(connection.identityConnection.awsRegion);
    let snapshot: ProvisioningSnapshot | undefined;
    let safeToRecordFailure = connection.status !== 'PROVISIONING';
    try {
      return await this.withMutationLock(connection, async () => {
        try {
          const metadata = await this.storage.get(
            connection.metadataReference!,
          );
          this.validator.validate(metadata);
          const previousProvider = await this.describeProviderOrUndefined(
            client,
            connection,
          );
          if (previousProvider && previousProvider.ProviderType !== 'SAML') {
            throw new ConflictException(
              'A non-SAML Cognito provider already uses this provider name',
            );
          }
          if (
            previousProvider &&
            !this.providerIsOwned(previousProvider, connection)
          ) {
            throw new ConflictException(
              'A foreign Cognito provider already uses this provider name',
            );
          }
          const appClient = await this.describeAppClient(client, connection);
          snapshot = {
            provider: previousProvider,
            appClient,
            appProviders: [...(appClient.SupportedIdentityProviders ?? [])],
            providerCreated: false,
            providerUpdated: false,
            appClientMutationAttempted: false,
            appClientUpdated: false,
          };
          const providerDetails = {
            MetadataFile: metadata,
            IDPSignout: 'true',
          };
          const mapping = jsonStringMap(connection.attributeMapping);
          if (!previousProvider) {
            await client.send(
              new CreateIdentityProviderCommand({
                UserPoolId: connection.identityConnection.cognitoUserPoolId,
                ProviderName: connection.cognitoProviderName,
                ProviderType: 'SAML',
                ProviderDetails: providerDetails,
                AttributeMapping: mapping,
                IdpIdentifiers: [this.ownershipMarker(connection)],
              }),
            );
            snapshot.providerCreated = true;
          } else if (
            !containsStringMap(
              previousProvider.ProviderDetails,
              providerDetails,
            ) ||
            !sameStringMap(previousProvider.AttributeMapping, mapping)
          ) {
            await client.send(
              new UpdateIdentityProviderCommand({
                UserPoolId: connection.identityConnection.cognitoUserPoolId,
                ProviderName: connection.cognitoProviderName,
                ProviderDetails: providerDetails,
                AttributeMapping: mapping,
                IdpIdentifiers: ownedProviderIdentifiers(
                  previousProvider,
                  this.ownershipMarker(connection),
                ),
              }),
            );
            snapshot.providerUpdated = true;
          }
          snapshot.appClientMutationAttempted =
            !(appClient.SupportedIdentityProviders ?? []).includes(
              connection.cognitoProviderName,
            );
          snapshot.appClientUpdated = await this.reconcileAppClientProvider(
            client,
            connection,
            true,
            appClient,
          );
          return await this.prisma.$transaction(async (tx) => {
            const result = await tx.samlConnection.update({
              where: { id: connection.id, tenantId },
              data: {
                status: 'READY',
                provisionedAt: new Date(),
                testedAt: null,
                testResult: Prisma.DbNull,
                lastErrorCode: null,
                lastErrorMessage: null,
              },
              select: PUBLIC_SELECT,
            });
            await this.audit(
              tx,
              tenantId,
              actorSubject,
              'saml.provisioned',
              id,
              {
                providerCreated: snapshot!.providerCreated,
                providerUpdated: snapshot!.providerUpdated,
                appClientMutationAttempted:
                  snapshot!.appClientMutationAttempted,
                appClientUpdated: snapshot!.appClientUpdated,
              },
            );
            return result;
          });
        } catch (error) {
          if (snapshot) {
            try {
              await this.restoreAwsState(
                client,
                connection,
                snapshot,
                error,
              );
              safeToRecordFailure = !snapshot.appProviders.includes(
                connection.cognitoProviderName,
              );
            } catch (rollbackError) {
              safeToRecordFailure = false;
              throw rollbackError;
            }
          }
          throw error;
        }
      });
    } catch (error) {
      if (safeToRecordFailure) {
        await this.recordFailure(
          tenantId,
          id,
          actorSubject,
          'saml.provision_failed',
          error,
          connection,
          true,
        );
      } else {
        await this.recordProvisioningRecoveryRequired(
          tenantId,
          id,
          actorSubject,
          error,
        );
      }
      throw error instanceof HttpException
        ? error
        : externalFailure('SAML provisioning failed', error);
    }
  }

  async test(tenantId: string, id: string, actorSubject: string) {
    const connection = await this.connection(tenantId, id);
    if (!['READY', 'ACTIVE'].includes(connection.status)) {
      throw new ConflictException('Provisioning must complete before testing');
    }
    const client = this.client(connection.identityConnection.awsRegion);
    try {
      if (!connection.metadataReference) {
        throw new Error('Stored SAML metadata reference is missing');
      }
      const metadata = await this.storage.get(connection.metadataReference);
      const provider = await this.describeProviderOrUndefined(
        client,
        connection,
      );
      const appClient = await this.describeAppClient(client, connection);
      const enabled =
        this.providerMatchesExpected(provider, connection, metadata) &&
        appClient.SupportedIdentityProviders?.includes(
          connection.cognitoProviderName,
        ) === true;
      if (!enabled) {
        throw new Error(
          'The SAML provider is not enabled on the Cognito app client',
        );
      }
      const loginUrl = managedLoginUrl(connection, appClient);
      const result = {
        providerConfigured: true,
        providerEnabled: true,
        providerHint: connection.cognitoProviderName,
        managedLoginUrl: loginUrl,
        finalAuthenticationConfirmed: false,
        message:
          'Provider configuration is ready; the application callback must confirm upstream authentication.',
      };
      await this.prisma.$transaction(async (tx) => {
        await tx.samlConnection.update({
          where: { id: connection.id, tenantId },
          data: {
            testedAt: new Date(),
            testResult: result,
            lastErrorCode: null,
            lastErrorMessage: null,
          },
        });
        await this.audit(
          tx,
          tenantId,
          actorSubject,
          'saml.test_succeeded',
          id,
          result,
        );
      });
      return result;
    } catch (error) {
      if (connection.status === 'ACTIVE') {
        await this.recordActiveTestFailure(
          tenantId,
          id,
          actorSubject,
          error,
        );
      } else {
        await this.recordReadyTestFailure(
          tenantId,
          id,
          actorSubject,
          error,
          connection,
        );
      }
      throw error instanceof HttpException
        ? error
        : externalFailure('SAML configuration test failed', error);
    }
  }

  async activate(tenantId: string, id: string, actorSubject: string) {
    const connection = await this.connection(tenantId, id);
    if (connection.status === 'ACTIVE') return this.status(tenantId, id);
    const result = connection.testResult as {
      providerConfigured?: boolean;
      providerEnabled?: boolean;
    } | null;
    if (
      connection.status !== 'READY' ||
      !connection.testedAt ||
      !connection.metadataValidatedAt ||
      result?.providerConfigured !== true ||
      result.providerEnabled !== true
    ) {
      throw new ConflictException(
        'A successful provider test is required before activation',
      );
    }
    if (connection.identityConnection.type === 'DEDICATED_COGNITO') {
      this.assertDedicatedPoolAuthorized(
        connection.identityConnection.awsRegion,
        connection.identityConnection.cognitoUserPoolId,
      );
    } else {
      this.assertSharedPoolApproved(
        connection.identityConnection.cognitoUserPoolId,
      );
    }
    const client = this.client(connection.identityConnection.awsRegion);
    return this.withMutationLock(connection, async () => {
      if (!connection.metadataReference) {
        throw new ConflictException(
          'Stored SAML metadata reference is missing',
        );
      }
      const metadata = await this.storage.get(connection.metadataReference);
      const provider = await this.describeProviderOrUndefined(
        client,
        connection,
      );
      const appClient = await this.describeAppClient(client, connection);
      if (
        !this.providerMatchesExpected(provider, connection, metadata) ||
        appClient.SupportedIdentityProviders?.includes(
          connection.cognitoProviderName,
        ) !== true
      ) {
        throw new ConflictException(
          'Cognito SAML provider is not owned, current, and enabled',
        );
      }
      return this.prisma.$transaction(async (tx) => {
        const transition = await tx.samlConnection.updateMany({
          where: {
            id: connection.id,
            tenantId,
            status: 'READY',
            testedAt: connection.testedAt,
            metadataValidatedAt: connection.metadataValidatedAt,
          },
          data: {
            status: 'ACTIVE',
            activatedAt: new Date(),
            disabledAt: null,
          },
        });
        if (transition.count !== 1) {
          throw new ConflictException(
            'SAML configuration changed while activation was in progress',
          );
        }
        if (connection.identityConnection.type === 'DEDICATED_COGNITO') {
          const updated = await tx.identityConnection.updateMany({
            where: {
              id: connection.identityConnection.id,
              tenantId,
              type: 'DEDICATED_COGNITO',
            },
            data: { status: 'ACTIVE' },
          });
          if (updated.count !== 1) {
            throw new ConflictException(
              'Dedicated identity connection is no longer eligible',
            );
          }
        }
        const updated = await tx.samlConnection.findFirst({
          where: { id: connection.id, tenantId, status: 'ACTIVE' },
          select: PUBLIC_SELECT,
        });
        if (!updated) {
          throw new ConflictException(
            'Activated SAML configuration could not be reloaded',
          );
        }
        await this.audit(
          tx,
          tenantId,
          actorSubject,
          'saml.activated',
          id,
          { identityConnectionType: connection.identityConnection.type },
        );
        return updated;
      });
    });
  }

  async disable(tenantId: string, id: string, actorSubject: string) {
    const connection = await this.connection(tenantId, id);
    if (
      !connection.provisionedAt ||
      !['READY', 'ACTIVE', 'ERROR', 'DISABLED'].includes(connection.status)
    ) {
      throw new ConflictException(
        'Only a provisioned SAML configuration can be disabled',
      );
    }
    const client = this.client(connection.identityConnection.awsRegion);
    let previousProviders: string[] | undefined;
    let awsStateSafe = true;
    let awsRestored = false;
    try {
      return await this.withMutationLock(connection, async () => {
        const provider = await this.describeProviderOrUndefined(
          client,
          connection,
        );
        if (!provider || !this.providerIsOwned(provider, connection)) {
          throw new ConflictException(
            'Cognito provider is missing or is not owned by this SAML connection',
          );
        }
        const appClient = await this.describeAppClient(client, connection);
        previousProviders = [
          ...(appClient.SupportedIdentityProviders ?? []),
        ];
        if (previousProviders.includes(connection.cognitoProviderName)) {
          awsStateSafe = false;
        }
        try {
          await this.reconcileAppClientProvider(
            client,
            connection,
            false,
            appClient,
          );
          return await this.prisma.$transaction(async (tx) => {
            if (connection.identityConnection.type === 'DEDICATED_COGNITO') {
              await tx.identityConnection.updateMany({
                where: {
                  id: connection.identityConnection.id,
                  tenantId,
                  type: 'DEDICATED_COGNITO',
                },
                data: { status: 'DISABLED' },
              });
            }
            const updated = await tx.samlConnection.update({
              where: { id: connection.id, tenantId },
              data: {
                status: 'DISABLED',
                disabledAt: new Date(),
              },
              select: PUBLIC_SELECT,
            });
            await this.audit(
              tx,
              tenantId,
              actorSubject,
              'saml.disabled',
              id,
            );
            return updated;
          });
        } catch (error) {
          try {
            await this.restoreAppClientProviders(
              client,
              connection,
              previousProviders,
            );
            awsRestored = true;
            awsStateSafe = true;
          } catch (rollbackError) {
            awsStateSafe = false;
            throw new Error(
              `${errorMessage(error)}; app-client rollback also failed: ${errorMessage(rollbackError)}`,
              { cause: error },
            );
          }
          throw error;
        }
      });
    } catch (error) {
      if (connection.status === 'ACTIVE' && awsStateSafe) {
        await this.recordActiveDisableFailure(
          tenantId,
          id,
          actorSubject,
          error,
          awsRestored,
        );
      } else {
        await this.recordFailure(
          tenantId,
          id,
          actorSubject,
          'saml.disable_failed',
          error,
          connection,
          false,
        );
      }
      throw error instanceof HttpException
        ? error
        : externalFailure('SAML disable failed', error);
    }
  }

  private async connection(
    tenantId: string,
    id: string,
  ): Promise<SamlWithConnection> {
    const connection = await this.prisma.samlConnection.findFirst({
      where: { id, tenantId },
      include: { identityConnection: true },
    });
    if (!connection) throw new NotFoundException('SAML connection not found');
    this.assertConnectionEligible(
      connection.identityConnection.type,
      connection.identityConnection.tenantId,
      tenantId,
    );
    if (connection.identityConnection.type === 'SHARED_COGNITO') {
      this.assertSharedPoolApproved(
        connection.identityConnection.cognitoUserPoolId,
      );
    }
    return connection;
  }

  private assertConnectionEligible(
    type: IdentityConnectionType,
    ownerTenantId: string | null,
    tenantId: string,
  ): void {
    if (type === 'DEDICATED_COGNITO' && ownerTenantId !== tenantId) {
      throw new BadRequestException(
        'Dedicated IdentityConnection must belong to this tenant',
      );
    }
    if (type === 'SHARED_COGNITO' && ownerTenantId !== null) {
      throw new BadRequestException(
        'Shared IdentityConnection must be platform-owned',
      );
    }
  }

  private assertSharedPoolApproved(poolId: string): void {
    const approved = environmentList('SAML_SHARED_POOL_IDS');
    if (!approved.includes(poolId)) {
      throw new BadRequestException(
        'This shared Cognito pool is not approved for SAML onboarding',
      );
    }
  }

  private assertDedicatedPoolAuthorized(region: string, poolId: string): void {
    const authorized = environmentList('IDENTITY_ADMIN_POOL_ARNS').some(
      (arn) => {
        const match = /^arn:[^:]+:cognito-idp:([^:]+):\d{12}:userpool\/(.+)$/.exec(
          arn,
        );
        return match?.[1] === region && match[2] === poolId;
      },
    );
    if (!authorized) {
      throw new ConflictException(
        'Dedicated Cognito pool is not authorized by IDENTITY_ADMIN_POOL_ARNS',
      );
    }
  }

  private async describeProviderOrUndefined(
    client: CognitoAdminClient,
    connection: SamlWithConnection,
  ): Promise<IdentityProviderType | undefined> {
    try {
      const response = await client.send(
        new DescribeIdentityProviderCommand({
          UserPoolId: connection.identityConnection.cognitoUserPoolId,
          ProviderName: connection.cognitoProviderName,
        }),
      );
      return response.IdentityProvider;
    } catch (error) {
      if (errorName(error) === 'ResourceNotFoundException') return undefined;
      throw error;
    }
  }

  private async describeAppClient(
    client: CognitoAdminClient,
    connection: SamlWithConnection,
  ): Promise<UserPoolClientType> {
    const response = await client.send(
      new DescribeUserPoolClientCommand({
        UserPoolId: connection.identityConnection.cognitoUserPoolId,
        ClientId: connection.identityConnection.clientId,
      }),
    );
    if (!response.UserPoolClient) {
      throw new Error('Cognito app client was not found');
    }
    return response.UserPoolClient;
  }

  private async restoreAwsState(
    client: CognitoAdminClient,
    connection: SamlWithConnection,
    snapshot: ProvisioningSnapshot,
    originalError: unknown,
  ): Promise<void> {
    try {
      if (snapshot.appClientMutationAttempted) {
        await this.restoreAppClientProviders(
          client,
          connection,
          snapshot.appProviders,
        );
      }
      if (!snapshot.provider) {
        const current = await this.describeProviderOrUndefined(
          client,
          connection,
        );
        if (!current || !this.providerIsOwned(current, connection)) return;
        await client.send(
          new DeleteIdentityProviderCommand({
            UserPoolId: connection.identityConnection.cognitoUserPoolId,
            ProviderName: connection.cognitoProviderName,
          }),
        );
      } else {
        await client.send(
          new UpdateIdentityProviderCommand({
            UserPoolId: connection.identityConnection.cognitoUserPoolId,
            ProviderName: connection.cognitoProviderName,
            ProviderDetails: restorableProviderDetails(
              snapshot.provider.ProviderDetails,
            ),
            AttributeMapping: snapshot.provider.AttributeMapping,
            IdpIdentifiers: snapshot.provider.IdpIdentifiers,
          }),
        );
      }
    } catch (rollbackError) {
      throw new Error(
        `${errorMessage(originalError)}; AWS rollback also failed: ${errorMessage(rollbackError)}`,
        { cause: originalError },
      );
    }
  }

  private async reconcileAppClientProvider(
    client: CognitoAdminClient,
    connection: SamlWithConnection,
    enabled: boolean,
    initial?: UserPoolClientType,
  ): Promise<boolean> {
    let current = initial ?? (await this.describeAppClient(client, connection));
    let updated = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const providers = new Set(current.SupportedIdentityProviders ?? []);
      const alreadyDesired =
        providers.has(connection.cognitoProviderName) === enabled;
      if (alreadyDesired) return updated;
      if (enabled) providers.add(connection.cognitoProviderName);
      else providers.delete(connection.cognitoProviderName);
      await client.send(
        new UpdateUserPoolClientCommand(
          appClientUpdate(
            connection.identityConnection.cognitoUserPoolId,
            connection.identityConnection.clientId,
            current,
            [...providers],
          ),
        ),
      );
      updated = true;
      current = await this.describeAppClient(client, connection);
      if (
        (current.SupportedIdentityProviders ?? []).includes(
          connection.cognitoProviderName,
        ) === enabled
      ) {
        return updated;
      }
    }
    throw new Error(
      'Cognito app-client provider state continued to drift after 3 attempts',
    );
  }

  private async restoreAppClientProviders(
    client: CognitoAdminClient,
    connection: SamlWithConnection,
    expectedProviders: string[],
    initial?: UserPoolClientType,
  ): Promise<void> {
    let current = initial ?? (await this.describeAppClient(client, connection));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (
        sameStringSet(
          current.SupportedIdentityProviders ?? [],
          expectedProviders,
        )
      ) {
        return;
      }
      await client.send(
        new UpdateUserPoolClientCommand(
          appClientUpdate(
            connection.identityConnection.cognitoUserPoolId,
            connection.identityConnection.clientId,
            current,
            expectedProviders,
          ),
        ),
      );
      current = await this.describeAppClient(client, connection);
    }
    throw new Error(
      'Cognito app-client provider rollback could not be verified',
    );
  }

  private async withMutationLock<T>(
    connection: SamlWithConnection,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = `saml-app-client:${connection.identityConnection.cognitoUserPoolId}:${connection.identityConnection.clientId}`;
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))
        `;
        return operation();
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
  }

  private ownershipMarker(connection: SamlWithConnection): string {
    const digest = createHash('sha256')
      .update(connection.id)
      .digest('hex')
      .slice(0, 32);
    return `att-${digest}`;
  }

  private providerIsOwned(
    provider: IdentityProviderType,
    connection: SamlWithConnection,
  ): boolean {
    return (
      provider.ProviderType === 'SAML' &&
      provider.IdpIdentifiers?.includes(this.ownershipMarker(connection)) ===
        true
    );
  }

  private providerMatchesExpected(
    provider: IdentityProviderType | undefined,
    connection: SamlWithConnection,
    metadata: string,
  ): boolean {
    return (
      !!provider &&
      this.providerIsOwned(provider, connection) &&
      containsStringMap(provider.ProviderDetails, {
        MetadataFile: metadata,
        IDPSignout: 'true',
      }) &&
      sameStringMap(
        provider.AttributeMapping,
        jsonStringMap(connection.attributeMapping),
      )
    );
  }

  private async setStatusAndAudit(
    tenantId: string,
    actorSubject: string,
    connection: SamlWithConnection,
    status: SamlConnectionStatus,
    action: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (connection.identityConnection.type === 'DEDICATED_COGNITO') {
        await tx.identityConnection.updateMany({
          where: {
            id: connection.identityConnection.id,
            tenantId,
            type: 'DEDICATED_COGNITO',
          },
          data: { status: 'DISABLED' },
        });
      }

      await tx.samlConnection.update({
        where: { id: connection.id, tenantId },
        data: { status, lastErrorCode: null, lastErrorMessage: null },
      });
      await this.audit(tx, tenantId, actorSubject, action, connection.id);
    });
  }

  private async recordActiveTestFailure(
    tenantId: string,
    id: string,
    actorSubject: string,
    error: unknown,
  ): Promise<void> {
    const code = errorName(error);
    const message = errorMessage(error).slice(0, 2000);
    const result = failedReadinessResult();
    await this.prisma.$transaction(async (tx) => {
      await tx.samlConnection.updateMany({
        where: { id, tenantId, status: 'ACTIVE' },
        data: {
          testedAt: new Date(),
          testResult: result,
          lastErrorCode: code,
          lastErrorMessage: message,
        },
      });
      await this.audit(
        tx,
        tenantId,
        actorSubject,
        'saml.active_test_failed',
        id,
        { code, errorMessage: message, ...result },
      );
    });
  }

  private async recordReadyTestFailure(
    tenantId: string,
    id: string,
    actorSubject: string,
    error: unknown,
    connection: SamlWithConnection,
  ): Promise<void> {
    const code = errorName(error);
    const errorDetail = errorMessage(error).slice(0, 2000);
    const testedAt = new Date();
    const result = failedReadinessResult();
    await this.prisma.$transaction(async (tx) => {
      const transition = await tx.samlConnection.updateMany({
        where: {
          id,
          tenantId,
          status: 'READY',
          testedAt: connection.testedAt,
          metadataValidatedAt: connection.metadataValidatedAt,
        },
        data: {
          status: 'ERROR',
          testedAt,
          testResult: result,
          lastErrorCode: code,
          lastErrorMessage: errorDetail,
        },
      });
      if (transition.count === 1) {
        if (connection.identityConnection.type === 'DEDICATED_COGNITO') {
          await tx.identityConnection.updateMany({
            where: {
              id: connection.identityConnection.id,
              tenantId,
              type: 'DEDICATED_COGNITO',
            },
            data: { status: 'DISABLED' },
          });
        }
        await this.audit(
          tx,
          tenantId,
          actorSubject,
          'saml.test_failed',
          id,
          { code, errorMessage: errorDetail, ...result },
        );
        return;
      }

      const current = await tx.samlConnection.findFirst({
        where: { id, tenantId },
        select: { status: true },
      });
      if (current?.status === 'ACTIVE') {
        const activeUpdate = await tx.samlConnection.updateMany({
          where: { id, tenantId, status: 'ACTIVE' },
          data: {
            testedAt,
            testResult: result,
            lastErrorCode: code,
            lastErrorMessage: errorDetail,
          },
        });
        if (activeUpdate.count === 1) {
          await this.audit(
            tx,
            tenantId,
            actorSubject,
            'saml.active_test_failed',
            id,
            { code, errorMessage: errorDetail, ...result },
          );
          return;
        }
      }
      await this.audit(
        tx,
        tenantId,
        actorSubject,
        'saml.stale_test_failure_discarded',
        id,
        {
          code,
          errorMessage: errorDetail,
          observedStatus: current?.status ?? 'MISSING',
        },
      );
    });
  }

  private async recordActiveDisableFailure(
    tenantId: string,
    id: string,
    actorSubject: string,
    error: unknown,
    appClientRestored: boolean,
  ): Promise<void> {
    const code = errorName(error);
    const message = errorMessage(error).slice(0, 2000);
    await this.prisma.$transaction(async (tx) => {
      await tx.samlConnection.updateMany({
        where: { id, tenantId, status: 'ACTIVE' },
        data: {
          lastErrorCode: code,
          lastErrorMessage: message,
        },
      });
      await this.audit(
        tx,
        tenantId,
        actorSubject,
        'saml.active_disable_failed',
        id,
        {
          code,
          message,
          appClientStatePreserved: true,
          appClientRestored,
        },
      );
    });
  }

  private async recordProvisioningRecoveryRequired(
    tenantId: string,
    id: string,
    actorSubject: string,
    error: unknown,
  ): Promise<void> {
    const code = errorName(error);
    const message = errorMessage(error).slice(0, 2000);
    await this.prisma.$transaction(async (tx) => {
      await tx.samlConnection.updateMany({
        where: { id, tenantId, status: 'PROVISIONING' },
        data: {
          lastErrorCode: code,
          lastErrorMessage: message,
        },
      });
      await this.audit(
        tx,
        tenantId,
        actorSubject,
        'saml.provision_recovery_required',
        id,
        { code, message },
      );
    });
  }

  private async recordFailure(
    tenantId: string,
    id: string,
    actorSubject: string,
    action: string,
    error: unknown,
    connection: SamlWithConnection,
    deactivateDedicated: boolean,
  ): Promise<void> {
    const code = errorName(error);
    const message = errorMessage(error).slice(0, 2000);
    try {
      await this.prisma.$transaction(async (tx) => {
        if (
          deactivateDedicated &&
          connection.identityConnection.type === 'DEDICATED_COGNITO'
        ) {
          await tx.identityConnection.updateMany({
            where: {
              id: connection.identityConnection.id,
              tenantId,
              type: 'DEDICATED_COGNITO',
            },
            data: { status: 'DISABLED' },
          });
        }
        const updated = await tx.samlConnection.updateMany({
          where: { id, tenantId },
          data: {
            status: 'ERROR',
            lastErrorCode: code,
            lastErrorMessage: message,
          },
        });
        if (updated.count === 1) {
          await this.audit(tx, tenantId, actorSubject, action, id, {
            code,
            message,
          });
        }
      });
    } catch (recordError) {
      throw new ServiceUnavailableException(
        `${message}; additionally unable to persist failure status: ${errorMessage(recordError)}`,
      );
    }
  }

  private client(region: string): CognitoAdminClient {
    const existing = this.clients.get(region);
    if (existing) return existing;
    const client = this.clientFactory(region);
    this.clients.set(region, client);
    return client;
  }

  private async audit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorSubject: string,
    action: string,
    entityId: string,
    metadata?: Prisma.InputJsonValue,
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        tenantId,
        actorSubject,
        action,
        entityType: 'SamlConnection',
        entityId,
        metadata,
      },
    });
  }
}

function safeAttributeMapping(
  value: Record<string, string> | undefined,
): Prisma.InputJsonObject {
  const mapping = value ?? { email: 'email' };
  const result: Record<string, string> = {};
  const entries = Object.entries(mapping);
  if (entries.length === 0 || entries.length > 25) {
    throw new BadRequestException(
      'SAML attribute mapping must contain between 1 and 25 entries',
    );
  }
  for (const [target, source] of entries) {
    if (
      !/^(?:address|birthdate|email|family_name|gender|given_name|locale|middle_name|name|nickname|phone_number|picture|preferred_username|profile|updated_at|website|zoneinfo|custom:[A-Za-z0-9_]+)$/.test(
        target,
      ) ||
      typeof source !== 'string' ||
      source.length < 1 ||
      source.length > 256 ||
      [...source].some((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127;
      }) ||
      ['__proto__', 'prototype', 'constructor'].includes(source)
    ) {
      throw new BadRequestException('SAML attribute mapping is not safe');
    }
    result[target] = source;
  }
  return result;
}

function assertCustomProviderName(name: string): void {
  if (BUILT_IN_COGNITO_PROVIDERS.has(name.toLowerCase())) {
    throw new BadRequestException(
      'Cognito built-in provider names are reserved',
    );
  }
}

function ownedProviderIdentifiers(
  provider: IdentityProviderType,
  marker: string,
): string[] {
  return [...new Set([...(provider.IdpIdentifiers ?? []), marker])];
}

function jsonStringMap(value: Prisma.JsonValue): Record<string, string> {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('Stored SAML attribute mapping is invalid');
  }
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') {
      throw new Error('Stored SAML attribute mapping is invalid');
    }
    result[key] = item;
  }
  return result;
}

function sameStringMap(
  left: Record<string, string> | undefined,
  right: Record<string, string>,
): boolean {
  return JSON.stringify(sorted(left ?? {})) === JSON.stringify(sorted(right));
}

function sorted(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function sameStringSet(left: string[], right: string[]): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  );
}

function appClientUpdate(
  userPoolId: string,
  clientId: string,
  existing: UserPoolClientType,
  supportedIdentityProviders: string[],
): UpdateUserPoolClientCommandInput {
  return {
    UserPoolId: userPoolId,
    ClientId: clientId,
    ClientName: existing.ClientName,
    RefreshTokenValidity: existing.RefreshTokenValidity,
    AccessTokenValidity: existing.AccessTokenValidity,
    IdTokenValidity: existing.IdTokenValidity,
    TokenValidityUnits: existing.TokenValidityUnits,
    ReadAttributes: existing.ReadAttributes,
    WriteAttributes: existing.WriteAttributes,
    ExplicitAuthFlows: existing.ExplicitAuthFlows,
    SupportedIdentityProviders: supportedIdentityProviders,
    CallbackURLs: existing.CallbackURLs,
    LogoutURLs: existing.LogoutURLs,
    DefaultRedirectURI: existing.DefaultRedirectURI,
    AllowedOAuthFlows: existing.AllowedOAuthFlows,
    AllowedOAuthScopes: existing.AllowedOAuthScopes,
    AllowedOAuthFlowsUserPoolClient:
      existing.AllowedOAuthFlowsUserPoolClient,
    AnalyticsConfiguration: existing.AnalyticsConfiguration,
    PreventUserExistenceErrors: existing.PreventUserExistenceErrors,
    EnableTokenRevocation: existing.EnableTokenRevocation,
    EnablePropagateAdditionalUserContextData:
      existing.EnablePropagateAdditionalUserContextData,
    AuthSessionValidity: existing.AuthSessionValidity,
    RefreshTokenRotation: existing.RefreshTokenRotation,
  };
}

function managedLoginUrl(
  connection: SamlWithConnection,
  client: UserPoolClientType,
): string {
  const url = new URL(connection.identityConnection.authorizationEndpoint);
  url.searchParams.set('client_id', connection.identityConnection.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set(
    'scope',
    connection.identityConnection.scopes.join(' '),
  );
  url.searchParams.set('identity_provider', connection.cognitoProviderName);
  const redirect = client.CallbackURLs?.[0];
  if (redirect) url.searchParams.set('redirect_uri', redirect);
  return url.toString();
}

function environmentList(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function errorName(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    typeof error.name === 'string'
  ) {
    return error.name;
  }
  return 'SamlOperationError';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function externalFailure(prefix: string, error: unknown) {
  return new ServiceUnavailableException(
    `${prefix}: ${errorMessage(error)}`,
  );
}

function failedReadinessResult() {
  return {
    providerConfigured: false,
    providerEnabled: false,
    finalAuthenticationConfirmed: false,
    message:
      'AWS readiness could not be confirmed; verify the provider configuration and retry.',
  };
}

function containsStringMap(
  current: Record<string, string> | undefined,
  desired: Record<string, string>,
): boolean {
  return Object.entries(desired).every(
    ([key, value]) => current?.[key] === value,
  );
}

function restorableProviderDetails(
  details: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!details) return undefined;
  return Object.fromEntries(
    ['MetadataFile', 'MetadataURL', 'EncryptedResponses', 'IDPSignout']
      .filter((key) => details[key] !== undefined)
      .map((key) => [key, details[key]]),
  );
}
