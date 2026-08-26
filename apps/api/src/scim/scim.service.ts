import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDeleteUserAttributesCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
  MessageActionType,
  UsernameExistsException,
  type AttributeType,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  ConflictException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApplicationRole, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  COGNITO_ADMIN_CLIENT_FACTORY,
  createCognitoAdminClient,
  type CognitoAdminClient,
  type CognitoAdminClientFactory,
} from '../tenant-users/cognito-admin';
import {
  SCIM_GROUP_SCHEMA,
  SCIM_LIST_SCHEMA,
  SCIM_PATCH_SCHEMA,
  SCIM_USER_SCHEMA,
  ScimException,
  isRecord,
  normalizeScimText,
  optionalString,
  parseFilter,
  parsePagination,
  requireRecord,
  validateEmails,
  type ScimContext,
  type ScimEmail,
  type ScimPatchOperation,
} from './scim-protocol';

const USER_FILTERS = new Set(['userName', 'externalId', 'id']);
const GROUP_FILTERS = new Set(['displayName', 'externalId', 'id']);
const USER_INCLUDE = {
  groupMemberships: {
    include: { group: { select: { id: true, displayName: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
  externalIdentity: {
    select: { providerSubject: true, providerUsername: true },
  },
} satisfies Prisma.ScimUserInclude;
const GROUP_INCLUDE = {
  members: {
    include: { user: { select: { id: true, userName: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.ScimGroupInclude;

type ScimUserRecord = Prisma.ScimUserGetPayload<{ include: typeof USER_INCLUDE }>;
type ScimGroupRecord = Prisma.ScimGroupGetPayload<{
  include: typeof GROUP_INCLUDE;
}>;

interface NormalizedUser {
  externalId: string | null;
  userName: string;
  normalizedUserName: string;
  givenName: string | null;
  familyName: string | null;
  formattedName: string | null;
  emails: ScimEmail[];
  primaryEmail: string | null;
  active: boolean;
}

interface ManagedIdentityConnection {
  id: string;
  type: 'SHARED_COGNITO' | 'DEDICATED_COGNITO';
  cognitoUserPoolId: string;
  awsRegion: string;
}

@Injectable()
export class ScimService {
  private readonly clients = new Map<string, CognitoAdminClient>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(COGNITO_ADMIN_CLIENT_FACTORY)
    private readonly clientFactory: CognitoAdminClientFactory =
      createCognitoAdminClient,
  ) {}

  serviceProviderConfig() {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      documentationUri: 'https://docs.example.invalid/scim',
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: true },
      authenticationSchemes: [
        {
          type: 'oauthbearertoken',
          name: 'Bearer token',
          description: 'Tenant and SAML connection scoped SCIM bearer token',
          specUri: 'https://www.rfc-editor.org/rfc/rfc6750',
          primary: true,
        },
      ],
      meta: { resourceType: 'ServiceProviderConfig', location: 'ServiceProviderConfig' },
    };
  }

  resourceTypes() {
    return {
      schemas: [SCIM_LIST_SCHEMA],
      totalResults: 2,
      startIndex: 1,
      itemsPerPage: 2,
      Resources: [
        {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
          id: 'User',
          name: 'User',
          endpoint: '/Users',
          schema: SCIM_USER_SCHEMA,
        },
        {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
          id: 'Group',
          name: 'Group',
          endpoint: '/Groups',
          schema: SCIM_GROUP_SCHEMA,
        },
      ],
    };
  }

  resourceType(id: string) {
    const resource = this.resourceTypes().Resources.find(
      (candidate) => candidate.id.toLowerCase() === id.toLowerCase(),
    );
    if (!resource) throw new NotFoundException('SCIM resource type was not found');
    return resource;
  }

  schemas() {
    return {
      schemas: [SCIM_LIST_SCHEMA],
      totalResults: 2,
      startIndex: 1,
      itemsPerPage: 2,
      Resources: [userSchema(), groupSchema()],
    };
  }

  schema(id: string) {
    const schema = [userSchema(), groupSchema()].find(
      (candidate) => candidate.id === id,
    );
    if (!schema) throw new NotFoundException('SCIM schema was not found');
    return schema;
  }

  async listUsers(
    context: ScimContext,
    baseUrl: string,
    query: { filter?: string; startIndex?: string; count?: string },
  ) {
    const filter = parseFilter(query.filter, USER_FILTERS);
    const page = parsePagination(query.startIndex, query.count);
    const where: Prisma.ScimUserWhereInput = {
      tenantId: context.tenantId,
      provisioningConnectionId: context.provisioningConnectionId,
      deletedAt: null,
      ...(filter
        ? filter.attribute === 'userName'
          ? { normalizedUserName: normalizeScimText(filter.value, 'userName') }
          : filter.attribute === 'externalId'
            ? { externalId: filter.value }
            : { id: filter.value }
        : {}),
    };
    const [totalResults, users] = await this.prisma.$transaction([
      this.prisma.scimUser.count({ where }),
      this.prisma.scimUser.findMany({
        where,
        include: USER_INCLUDE,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: page.skip,
        take: page.count,
      }),
    ]);
    return {
      schemas: [SCIM_LIST_SCHEMA],
      totalResults,
      startIndex: page.startIndex,
      itemsPerPage: users.length,
      Resources: users.map((user) => this.userResource(user, baseUrl)),
    };
  }

  async getUser(context: ScimContext, id: string, baseUrl: string) {
    return this.userResource(await this.user(context, id), baseUrl);
  }

  async createUser(context: ScimContext, body: unknown, baseUrl: string) {
    const input = normalizeUser(body, true);
    const existing = await this.prisma.scimUser.findFirst({
      where: {
        tenantId: context.tenantId,
        provisioningConnectionId: context.provisioningConnectionId,
        OR: [
          { normalizedUserName: input.normalizedUserName },
          ...(input.externalId ? [{ externalId: input.externalId }] : []),
        ],
      },
      include: USER_INCLUDE,
    });
    if (existing?.deletedAt) {
      const emailChanged = existing.primaryEmail !== input.primaryEmail;
      const activeChanged = existing.active !== input.active;
      let cognitoActiveChanged = false;
      try {
        if (emailChanged) {
          await this.updateCognitoAttributes(context, existing, input);
        }
        if (activeChanged) {
          cognitoActiveChanged = await this.setActive(
            context,
            existing,
            input.active,
          );
        }
        const restored = await this.prisma.$transaction(async (tx) => {
          await tx.tenantMembership.update({
            where: { id: existing.tenantMembershipId },
            data: {
              email: input.primaryEmail,
              active: input.active,
              lifecycleStatus: input.active ? 'ACTIVE' : 'DISABLED',
              disabledAt: input.active ? null : new Date(),
            },
          });
          const result = await tx.scimUser.update({
            where: { id: existing.id },
            data: {
              ...userData(input),
              deletedAt: null,
              version: { increment: 1 },
            },
            include: USER_INCLUDE,
          });
          await this.auditTx(
            tx,
            context,
            'scim.user.reactivated',
            result.id,
            safeUserAudit(result),
          );
          return result;
        });
        await this.recalculateRole(context, restored.id);
        return this.userResource(restored, baseUrl);
      } catch (error) {
        await this.compensateUserMutation(
          context,
          existing,
          emailChanged,
          cognitoActiveChanged,
        );
        throw mapPersistenceError(error);
      }
    }
    if (existing) {
      throw new ScimException(
        HttpStatus.CONFLICT,
        'A user with this userName or externalId already exists',
        'uniqueness',
      );
    }

    const connection = await this.identityConnection(context);
    const resourceId = randomUUID();
    const membershipId = randomUUID();
    const externalIdentityId = randomUUID();
    const providerUsername = `scim-${resourceId}`;
    const { user: cognito, created } = await this.createOrGetCognitoUser(
      connection,
      providerUsername,
      input.primaryEmail,
      context.tenantId,
    );
    const providerSubject = attribute(cognito.UserAttributes, 'sub');
    if (!cognito.Username || !providerSubject) {
      if (created) await this.deleteCognitoUser(connection, providerUsername);
      throw new ServiceUnavailableException(
        'Cognito did not return an immutable user subject',
      );
    }
    let disabledBeforePersistence = false;
    try {
      if (!input.active) {
        await this.setCognitoEnabled(connection, cognito.Username, false);
        disabledBeforePersistence = true;
      }
      const createdUser = await this.prisma.$transaction(async (tx) => {
        const provisioning = await tx.scimProvisioningConnection.findFirst({
          where: {
            id: context.provisioningConnectionId,
            tenantId: context.tenantId,
            enabled: true,
            samlConnection: { status: 'ACTIVE' },
            identityConnection: { status: 'ACTIVE' },
          },
          select: { defaultRole: true },
        });
        if (!provisioning) {
          throw new ConflictException('SCIM connection is no longer active');
        }
        await tx.tenantMembership.create({
          data: {
            id: membershipId,
            tenantId: context.tenantId,
            cognitoSubject: providerSubject,
            email: input.primaryEmail,
            role: provisioning.defaultRole,
            active: input.active,
            lifecycleStatus: input.active ? 'ACTIVE' : 'DISABLED',
            disabledAt: input.active ? null : new Date(),
          },
        });
        await tx.externalIdentity.create({
          data: {
            id: externalIdentityId,
            tenantId: context.tenantId,
            tenantMembershipId: membershipId,
            connectionId: context.identityConnectionId,
            providerSubject,
            providerUsername: cognito.Username,
          },
        });
        const result = await tx.scimUser.create({
          data: {
            id: resourceId,
            tenantId: context.tenantId,
            provisioningConnectionId: context.provisioningConnectionId,
            identityConnectionId: context.identityConnectionId,
            tenantMembershipId: membershipId,
            externalIdentityId,
            ...userData(input),
          },
          include: USER_INCLUDE,
        });
        await this.auditTx(
          tx,
          context,
          'scim.user.created',
          result.id,
          safeUserAudit(result),
        );
        return result;
      });
      return this.userResource(createdUser, baseUrl);
    } catch (error) {
      if (created) {
        try {
          await this.deleteCognitoUser(connection, providerUsername);
        } catch (compensationError) {
          throw new ServiceUnavailableException(
            `SCIM persistence failed and Cognito compensation requires attention: ${errorMessage(compensationError)}`,
          );
        }
      } else if (disabledBeforePersistence) {
        await this.setCognitoEnabled(connection, providerUsername, true);
      }
      throw mapPersistenceError(error);
    }
  }

  async replaceUser(
    context: ScimContext,
    id: string,
    body: unknown,
    baseUrl: string,
  ) {
    const current = await this.user(context, id);
    const input = normalizeUser(body, true);
    if (sameUser(current, input)) return this.userResource(current, baseUrl);
    const emailChanged = current.primaryEmail !== input.primaryEmail;
    const activeChanged = current.active !== input.active;
    let cognitoActiveChanged = false;
    try {
      if (emailChanged) {
        await this.updateCognitoAttributes(context, current, input);
      }
      if (activeChanged) {
        cognitoActiveChanged = await this.setActive(
          context,
          current,
          input.active,
        );
      }
    } catch (error) {
      if (emailChanged) {
        await this.restoreCognitoEmail(context, current);
      }
      throw error;
    }
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.tenantMembership.update({
          where: { id: current.tenantMembershipId },
          data: {
            email: input.primaryEmail,
            active: input.active,
            lifecycleStatus: input.active ? 'ACTIVE' : 'DISABLED',
            disabledAt: input.active ? null : new Date(),
          },
        });
        const result = await tx.scimUser.update({
          where: { id: current.id },
          data: { ...userData(input), version: { increment: 1 } },
          include: USER_INCLUDE,
        });
        await this.auditTx(
          tx,
          context,
          'scim.user.replaced',
          result.id,
          safeUserAudit(result),
        );
        return result;
      });
      await this.recalculateRole(context, id);
      return this.userResource(updated, baseUrl);
    } catch (error) {
      try {
        await this.compensateUserMutation(
          context,
          current,
          emailChanged,
          cognitoActiveChanged,
        );
      } catch (compensationError) {
        throw new ServiceUnavailableException(
          `SCIM update failed and Cognito compensation requires attention: ${errorMessage(compensationError)}`,
        );
      }
      throw mapPersistenceError(error);
    }
  }

  async patchUser(
    context: ScimContext,
    id: string,
    body: unknown,
    baseUrl: string,
  ) {
    const current = await this.user(context, id);
    const operations = parsePatch(body);
    let draft = userDraft(current);
    for (const operation of operations) draft = applyUserPatch(draft, operation);
    const input = normalizeUser(draft, true);
    if (sameUser(current, input)) return this.userResource(current, baseUrl);
    return this.replaceUser(context, id, input, baseUrl);
  }

  async deleteUser(context: ScimContext, id: string) {
    const current = await this.user(context, id);
    const cognitoActiveChanged = await this.setActive(context, current, false);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.tenantMembership.update({
          where: { id: current.tenantMembershipId },
          data: {
            active: false,
            lifecycleStatus: 'DISABLED',
            disabledAt: new Date(),
          },
        });
        await tx.scimUser.update({
          where: { id: current.id },
          data: {
            active: false,
            deletedAt: new Date(),
            version: { increment: 1 },
          },
        });
        await this.auditTx(tx, context, 'scim.user.deleted', current.id);
      });
    } catch (error) {
      try {
        await this.compensateUserMutation(
          context,
          current,
          false,
          cognitoActiveChanged,
        );
      } catch (compensationError) {
        throw new ServiceUnavailableException(
          `SCIM delete failed and Cognito compensation requires attention: ${errorMessage(compensationError)}`,
        );
      }
      throw error;
    }
  }

  async listGroups(
    context: ScimContext,
    baseUrl: string,
    query: { filter?: string; startIndex?: string; count?: string },
  ) {
    const filter = parseFilter(query.filter, GROUP_FILTERS);
    const page = parsePagination(query.startIndex, query.count);
    const where: Prisma.ScimGroupWhereInput = {
      tenantId: context.tenantId,
      provisioningConnectionId: context.provisioningConnectionId,
      ...(filter
        ? filter.attribute === 'displayName'
          ? {
              normalizedDisplayName: normalizeScimText(
                filter.value,
                'displayName',
              ),
            }
          : filter.attribute === 'externalId'
            ? { externalId: filter.value }
            : { id: filter.value }
        : {}),
    };
    const [totalResults, groups] = await this.prisma.$transaction([
      this.prisma.scimGroup.count({ where }),
      this.prisma.scimGroup.findMany({
        where,
        include: GROUP_INCLUDE,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: page.skip,
        take: page.count,
      }),
    ]);
    return {
      schemas: [SCIM_LIST_SCHEMA],
      totalResults,
      startIndex: page.startIndex,
      itemsPerPage: groups.length,
      Resources: groups.map((group) => this.groupResource(group, baseUrl)),
    };
  }

  async getGroup(context: ScimContext, id: string, baseUrl: string) {
    return this.groupResource(await this.group(context, id), baseUrl);
  }

  async createGroup(context: ScimContext, body: unknown, baseUrl: string) {
    const input = normalizeGroup(body);
    const userIds = await this.validateMemberIds(context, input.memberIds);
    try {
      const group = await this.prisma.$transaction(async (tx) => {
        const result = await tx.scimGroup.create({
          data: {
            tenantId: context.tenantId,
            provisioningConnectionId: context.provisioningConnectionId,
            externalId: input.externalId,
            displayName: input.displayName,
            normalizedDisplayName: input.normalizedDisplayName,
            members: {
              create: userIds.map((userId) => ({
                tenantId: context.tenantId,
                provisioningConnectionId: context.provisioningConnectionId,
                userId,
              })),
            },
          },
          include: GROUP_INCLUDE,
        });
        await this.auditTx(tx, context, 'scim.group.created', result.id, {
          displayName: result.displayName,
          memberCount: userIds.length,
        });
        return result;
      });
      await this.recalculateRoles(context, userIds);
      return this.groupResource(group, baseUrl);
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async replaceGroup(
    context: ScimContext,
    id: string,
    body: unknown,
    baseUrl: string,
  ) {
    const current = await this.group(context, id);
    const input = normalizeGroup(body);
    const userIds = await this.validateMemberIds(context, input.memberIds);
    if (sameGroup(current, input, userIds)) {
      return this.groupResource(current, baseUrl);
    }
    const affected = [
      ...new Set([...current.members.map((member) => member.userId), ...userIds]),
    ];
    try {
      const group = await this.prisma.$transaction(async (tx) => {
        await tx.scimGroupMember.deleteMany({ where: { groupId: id } });
        const result = await tx.scimGroup.update({
          where: { id },
          data: {
            externalId: input.externalId,
            displayName: input.displayName,
            normalizedDisplayName: input.normalizedDisplayName,
            version: { increment: 1 },
            members: {
              create: userIds.map((userId) => ({
                tenantId: context.tenantId,
                provisioningConnectionId: context.provisioningConnectionId,
                userId,
              })),
            },
          },
          include: GROUP_INCLUDE,
        });
        await this.auditTx(tx, context, 'scim.group.replaced', result.id, {
          displayName: result.displayName,
          memberCount: userIds.length,
        });
        return result;
      });
      await this.recalculateRoles(context, affected);
      return this.groupResource(group, baseUrl);
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async patchGroup(
    context: ScimContext,
    id: string,
    body: unknown,
    baseUrl: string,
  ) {
    const current = await this.group(context, id);
    const operations = parsePatch(body);
    let draft = groupDraft(current);
    for (const operation of operations) {
      draft = applyGroupPatch(draft, operation);
    }
    return this.replaceGroup(context, id, draft, baseUrl);
  }

  async deleteGroup(context: ScimContext, id: string) {
    const current = await this.group(context, id);
    const affected = current.members.map((member) => member.userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.scimGroup.delete({ where: { id } });
      await this.auditTx(tx, context, 'scim.group.deleted', id, {
        displayName: current.displayName,
        memberCount: affected.length,
      });
    });
    await this.recalculateRoles(context, affected);
  }

  async idempotent<T>(
    context: ScimContext,
    key: string | undefined,
    method: string,
    path: string,
    body: unknown,
    status: number,
    action: () => Promise<T>,
  ): Promise<{ status: number; body: T }> {
    if (!key) return { status, body: await action() };
    if (!/^[\x21-\x7E]{1,128}$/.test(key)) {
      throw new ScimException(
        HttpStatus.BAD_REQUEST,
        'Idempotency-Key must contain 1 to 128 visible ASCII characters',
        'invalidValue',
      );
    }
    const requestHash = createHash('sha256')
      .update(`${method}\n${path}\n${stableJson(body)}`)
      .digest('hex');
    await this.prisma.scimIdempotencyRecord.deleteMany({
      where: {
        provisioningConnectionId: context.provisioningConnectionId,
        idempotencyKey: key,
        expiresAt: { lt: new Date() },
      },
    });
    try {
      await this.prisma.scimIdempotencyRecord.create({
        data: {
          tenantId: context.tenantId,
          provisioningConnectionId: context.provisioningConnectionId,
          idempotencyKey: key,
          requestHash,
          method,
          requestPath: path,
          responseStatus: 0,
          responseBody: { state: 'PROCESSING' },
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.prisma.scimIdempotencyRecord.findUnique({
        where: {
          provisioningConnectionId_idempotencyKey: {
            provisioningConnectionId: context.provisioningConnectionId,
            idempotencyKey: key,
          },
        },
      });
      if (
        !existing ||
        existing.requestHash !== requestHash ||
        existing.method !== method ||
        existing.requestPath !== path
      ) {
        throw new ScimException(
          HttpStatus.CONFLICT,
          'Idempotency-Key was already used for a different request',
          'uniqueness',
        );
      }
      if (existing.responseStatus === 0) {
        throw new ScimException(
          HttpStatus.CONFLICT,
          'A request with this Idempotency-Key is still in progress',
          'uniqueness',
        );
      }
      return {
        status: existing.responseStatus,
        body: existing.responseBody as T,
      };
    }
    try {
      const responseBody = await action();
      await this.prisma.scimIdempotencyRecord.update({
        where: {
          provisioningConnectionId_idempotencyKey: {
            provisioningConnectionId: context.provisioningConnectionId,
            idempotencyKey: key,
          },
        },
        data: {
          responseStatus: status,
          responseBody: responseBody as Prisma.InputJsonValue,
        },
      });
      return { status, body: responseBody };
    } catch (error) {
      await this.prisma.scimIdempotencyRecord.deleteMany({
        where: {
          provisioningConnectionId: context.provisioningConnectionId,
          idempotencyKey: key,
          requestHash,
          responseStatus: 0,
        },
      });
      throw error;
    }
  }

  async recalculateRole(context: ScimContext, userId: string) {
    const user = await this.prisma.scimUser.findFirst({
      where: {
        id: userId,
        tenantId: context.tenantId,
        provisioningConnectionId: context.provisioningConnectionId,
      },
      select: {
        tenantMembershipId: true,
        provisioningConnection: {
          select: { defaultRole: true, privilegedRolePolicy: true },
        },
        groupMemberships: {
          select: {
            group: {
              select: {
                roleMapping: {
                  select: { role: true, privilegedConfirmedAt: true },
                },
              },
            },
          },
        },
      },
    });
    if (!user) return;
    const eligible = user.groupMemberships
      .map((membership) => membership.group.roleMapping)
      .filter((mapping): mapping is NonNullable<typeof mapping> => !!mapping)
      .filter(
        (mapping) =>
          mapping.role !== 'TENANT_ADMIN' ||
          (user.provisioningConnection.privilegedRolePolicy &&
            !!mapping.privilegedConfirmedAt),
      )
      .map((mapping) => mapping.role);
    const role = deterministicRole([
      user.provisioningConnection.defaultRole,
      ...eligible,
    ]);
    await this.prisma.tenantMembership.updateMany({
      where: {
        id: user.tenantMembershipId,
        tenantId: context.tenantId,
        role: { not: role },
      },
      data: { role },
    });
  }

  private async recalculateRoles(context: ScimContext, userIds: string[]) {
    for (const userId of [...new Set(userIds)].sort()) {
      await this.recalculateRole(context, userId);
    }
  }

  private async user(context: ScimContext, id: string) {
    const user = await this.prisma.scimUser.findFirst({
      where: {
        id,
        tenantId: context.tenantId,
        provisioningConnectionId: context.provisioningConnectionId,
        deletedAt: null,
      },
      include: USER_INCLUDE,
    });
    if (!user) throw new NotFoundException('SCIM user was not found');
    return user;
  }

  private async group(context: ScimContext, id: string) {
    const group = await this.prisma.scimGroup.findFirst({
      where: {
        id,
        tenantId: context.tenantId,
        provisioningConnectionId: context.provisioningConnectionId,
      },
      include: GROUP_INCLUDE,
    });
    if (!group) throw new NotFoundException('SCIM group was not found');
    return group;
  }

  private userResource(user: ScimUserRecord, baseUrl: string) {
    return {
      schemas: [SCIM_USER_SCHEMA],
      id: user.id,
      ...(user.externalId ? { externalId: user.externalId } : {}),
      userName: user.userName,
      name: {
        ...(user.formattedName ? { formatted: user.formattedName } : {}),
        ...(user.givenName ? { givenName: user.givenName } : {}),
        ...(user.familyName ? { familyName: user.familyName } : {}),
      },
      emails: user.emails,
      active: user.active,
      groups: user.groupMemberships.map((membership) => ({
        value: membership.group.id,
        display: membership.group.displayName,
        type: 'direct',
        $ref: `${baseUrl}/Groups/${membership.group.id}`,
      })),
      meta: {
        resourceType: 'User',
        created: user.createdAt.toISOString(),
        lastModified: user.updatedAt.toISOString(),
        version: `W/"${user.version}"`,
        location: `${baseUrl}/Users/${user.id}`,
      },
    };
  }

  private groupResource(group: ScimGroupRecord, baseUrl: string) {
    return {
      schemas: [SCIM_GROUP_SCHEMA],
      id: group.id,
      ...(group.externalId ? { externalId: group.externalId } : {}),
      displayName: group.displayName,
      members: group.members.map((member) => ({
        value: member.user.id,
        display: member.user.userName,
        type: 'User',
        $ref: `${baseUrl}/Users/${member.user.id}`,
      })),
      meta: {
        resourceType: 'Group',
        created: group.createdAt.toISOString(),
        lastModified: group.updatedAt.toISOString(),
        version: `W/"${group.version}"`,
        location: `${baseUrl}/Groups/${group.id}`,
      },
    };
  }

  private async identityConnection(
    context: ScimContext,
  ): Promise<ManagedIdentityConnection> {
    const connection = await this.prisma.identityConnection.findFirst({
      where: {
        id: context.identityConnectionId,
        status: 'ACTIVE',
        scimConnections: {
          some: {
            id: context.provisioningConnectionId,
            tenantId: context.tenantId,
            enabled: true,
            samlConnection: { status: 'ACTIVE' },
          },
        },
      },
      select: {
        id: true,
        type: true,
        cognitoUserPoolId: true,
        awsRegion: true,
      },
    });
    if (!connection) {
      throw new ScimException(
        HttpStatus.FORBIDDEN,
        'Provisioning connection is inactive',
      );
    }
    return connection;
  }

  private async createOrGetCognitoUser(
    connection: ManagedIdentityConnection,
    providerUsername: string,
    email: string | null,
    tenantId: string,
  ) {
    const client = this.client(connection.awsRegion);
    try {
      const result = await client.send(
        new AdminCreateUserCommand({
          UserPoolId: connection.cognitoUserPoolId,
          Username: providerUsername,
          MessageAction: MessageActionType.SUPPRESS,
          UserAttributes: email
            ? [
                { Name: 'email', Value: email },
                { Name: 'email_verified', Value: 'true' },
              ]
            : [],
          ClientMetadata: { tenantId, source: 'scim' },
        }),
      );
      return {
        created: true,
        user: {
          Username: result.User?.Username,
          UserAttributes: result.User?.Attributes,
        },
      };
    } catch (error) {
      if (!(error instanceof UsernameExistsException)) throw error;
      return {
        created: false,
        user: await client.send(
          new AdminGetUserCommand({
            UserPoolId: connection.cognitoUserPoolId,
            Username: providerUsername,
          }),
        ),
      };
    }
  }

  private async updateCognitoAttributes(
    context: ScimContext,
    user: ScimUserRecord,
    input: NormalizedUser,
  ) {
    if (user.primaryEmail === input.primaryEmail) return;
    const connection = await this.identityConnection(context);
    const providerUsername = user.externalIdentity.providerUsername;
    if (!providerUsername) {
      throw new ServiceUnavailableException(
        'SCIM user has no Cognito administrative username',
      );
    }

    await this.updateCognitoEmail(
      connection,
      providerUsername,
      input.primaryEmail,
    );
  }

  private async restoreCognitoEmail(
    context: ScimContext,
    user: ScimUserRecord,
  ) {
    const connection = await this.identityConnection(context);
    const providerUsername = user.externalIdentity.providerUsername;
    if (!providerUsername) {
      throw new ServiceUnavailableException(
        'SCIM user has no Cognito administrative username',
      );
    }
    await this.updateCognitoEmail(
      connection,
      providerUsername,
      user.primaryEmail,
    );
  }

  private async setActive(
    context: ScimContext,
    user: ScimUserRecord,
    active: boolean,
  ): Promise<boolean> {
    if (user.active === active) return false;
    if (active) {
      const connection = await this.identityConnection(context);
      const providerUsername = user.externalIdentity.providerUsername;
      if (!providerUsername) {
        throw new ServiceUnavailableException(
          'SCIM user has no Cognito administrative username',
        );
      }
      await this.client(connection.awsRegion).send(
        new AdminEnableUserCommand({
          UserPoolId: connection.cognitoUserPoolId,
          Username: providerUsername,
        }),
      );
      return true;
    }
    return this.disableCognitoIfSafe(context, user);
  }

  private async disableCognitoIfSafe(
    context: ScimContext,
    user: ScimUserRecord,
  ): Promise<boolean> {
    const connection = await this.identityConnection(context);
    const otherActive =
      connection.type === 'SHARED_COGNITO'
        ? await this.prisma.externalIdentity.count({
            where: {
              connectionId: connection.id,
              providerSubject: user.externalIdentity.providerSubject,
              tenantId: { not: context.tenantId },
              tenantMembership: { active: true },
            },
          })
        : 0;
    if (otherActive > 0) return false;
    const providerUsername = user.externalIdentity.providerUsername;
    if (!providerUsername) {
      throw new ServiceUnavailableException(
        'SCIM user has no Cognito administrative username',
      );
    }
    await this.client(connection.awsRegion).send(
      new AdminDisableUserCommand({
        UserPoolId: connection.cognitoUserPoolId,
        Username: providerUsername,
      }),
    );
    return true;
  }

  private async deleteCognitoUser(
    connection: ManagedIdentityConnection,
    providerUsername: string,
  ) {
    await this.client(connection.awsRegion).send(
      new AdminDeleteUserCommand({
        UserPoolId: connection.cognitoUserPoolId,
        Username: providerUsername,
      }),
    );
  }

  private async setCognitoEnabled(
    connection: ManagedIdentityConnection,
    providerUsername: string,
    enabled: boolean,
  ) {
    await this.client(connection.awsRegion).send(
      enabled
        ? new AdminEnableUserCommand({
            UserPoolId: connection.cognitoUserPoolId,
            Username: providerUsername,
          })
        : new AdminDisableUserCommand({
            UserPoolId: connection.cognitoUserPoolId,
            Username: providerUsername,
          }),
    );
  }

  private async updateCognitoEmail(
    connection: ManagedIdentityConnection,
    providerUsername: string,
    email: string | null,
  ) {
    if (!email) {
      await this.client(connection.awsRegion).send(
        new AdminDeleteUserAttributesCommand({
          UserPoolId: connection.cognitoUserPoolId,
          Username: providerUsername,
          UserAttributeNames: ['email', 'email_verified'],
        }),
      );
      return;
    }
    await this.client(connection.awsRegion).send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: connection.cognitoUserPoolId,
        Username: providerUsername,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
        ],
      }),
    );
  }

  private async compensateUserMutation(
    context: ScimContext,
    user: ScimUserRecord,
    emailChanged: boolean,
    cognitoActiveChanged: boolean,
  ) {
    if (cognitoActiveChanged) {
      const connection = await this.identityConnection(context);
      const providerUsername = user.externalIdentity.providerUsername;
      if (!providerUsername) throw new Error('missing providerUsername');
      await this.setCognitoEnabled(connection, providerUsername, user.active);
    }
    if (emailChanged) {
      await this.restoreCognitoEmail(context, user);
    }
  }

  private async validateMemberIds(
    context: ScimContext,
    ids: string[],
  ): Promise<string[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const users = await this.prisma.scimUser.findMany({
      where: {
        id: { in: unique },
        tenantId: context.tenantId,
        provisioningConnectionId: context.provisioningConnectionId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (users.length !== unique.length) {
      throw new ScimException(
        HttpStatus.BAD_REQUEST,
        'Every group member must reference a user in this SCIM connection',
        'invalidValue',
      );
    }
    return unique.sort();
  }

  private client(region: string) {
    const existing = this.clients.get(region);
    if (existing) return existing;
    const client = this.clientFactory(region);
    this.clients.set(region, client);
    return client;
  }

  private audit(
    context: ScimContext,
    action: string,
    entityId: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    return this.prisma.auditEvent.create({
      data: {
        tenantId: context.tenantId,
        actorSubject: `scim:${context.credentialId}`,
        action,
        entityType: action.includes('.group.') ? 'ScimGroup' : 'ScimUser',
        entityId,
        metadata: auditMetadata(context, metadata),
      },
    });
  }

  private auditTx(
    tx: Prisma.TransactionClient,
    context: ScimContext,
    action: string,
    entityId: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    return tx.auditEvent.create({
      data: {
        tenantId: context.tenantId,
        actorSubject: `scim:${context.credentialId}`,
        action,
        entityType: action.includes('.group.') ? 'ScimGroup' : 'ScimUser',
        entityId,
        metadata: auditMetadata(context, metadata),
      },
    });
  }
}

function normalizeUser(body: unknown, requireUserName: boolean): NormalizedUser {
  const value = requireRecord(body);
  const userName = optionalString(value.userName, 'userName', 320);
  if (requireUserName && !userName) {
    throw new ScimException(
      HttpStatus.BAD_REQUEST,
      'userName is required',
      'invalidValue',
    );
  }
  if (value.active !== undefined && typeof value.active !== 'boolean') {
    throw new ScimException(
      HttpStatus.BAD_REQUEST,
      'active must be boolean',
      'invalidValue',
    );
  }
  const name =
    value.name === undefined || value.name === null
      ? {}
      : requireRecord(value.name, 'name');
  const emails = validateEmails(value.emails);
  const primaryEmail =
    emails.find((email) => email.primary)?.value ?? emails[0]?.value ?? null;
  const resolvedUserName = userName!;
  return {
    externalId: optionalString(value.externalId, 'externalId'),
    userName: resolvedUserName,
    normalizedUserName: normalizeScimText(resolvedUserName, 'userName'),
    givenName: optionalString(name.givenName, 'name.givenName', 256),
    familyName: optionalString(name.familyName, 'name.familyName', 256),
    formattedName: optionalString(name.formatted, 'name.formatted', 512),
    emails,
    primaryEmail,
    active: value.active === undefined ? true : value.active,
  };
}

function userData(input: NormalizedUser) {
  return {
    externalId: input.externalId,
    userName: input.userName,
    normalizedUserName: input.normalizedUserName,
    givenName: input.givenName,
    familyName: input.familyName,
    formattedName: input.formattedName,
    emails: input.emails as unknown as Prisma.InputJsonValue,
    primaryEmail: input.primaryEmail,
    active: input.active,
  };
}

function userDraft(user: ScimUserRecord): Record<string, unknown> {
  return {
    userName: user.userName,
    externalId: user.externalId,
    active: user.active,
    name: {
      formatted: user.formattedName,
      givenName: user.givenName,
      familyName: user.familyName,
    },
    emails: user.emails,
  };
}

function applyUserPatch(
  draft: Record<string, unknown>,
  operation: ScimPatchOperation,
) {
  if (!operation.path) {
    if (operation.op === 'remove' || !isRecord(operation.value)) {
      throw invalidPath('A path is required unless add/replace value is an object');
    }
    for (const [path, value] of Object.entries(operation.value)) {
      draft = applyUserPatch(draft, { ...operation, path, value });
    }
    return draft;
  }
  const path = operation.path.toLowerCase();
  const supported = new Set([
    'active',
    'externalid',
    'name',
    'name.formatted',
    'name.givenname',
    'name.familyname',
    'emails',
  ]);
  if (!supported.has(path)) throw invalidPath(`Unsupported user PATCH path ${operation.path}`);
  if (operation.op === 'remove') {
    if (path === 'active') throw invalidPath('active cannot be removed');
    if (path === 'name') draft.name = {};
    else if (path.startsWith('name.')) {
      const name = isRecord(draft.name) ? { ...draft.name } : {};
      const key =
        path === 'name.givenname'
          ? 'givenName'
          : path === 'name.familyname'
            ? 'familyName'
            : 'formatted';
      delete name[key];
      draft.name = name;
    } else if (path === 'externalid') draft.externalId = null;
    else if (path === 'emails') draft.emails = [];
    return draft;
  }
  if (path === 'active') draft.active = operation.value;
  else if (path === 'externalid') draft.externalId = operation.value;
  else if (path === 'emails') draft.emails = operation.value;
  else if (path === 'name') draft.name = operation.value;
  else {
    const name = isRecord(draft.name) ? { ...draft.name } : {};
    const key =
      path === 'name.givenname'
        ? 'givenName'
        : path === 'name.familyname'
          ? 'familyName'
          : 'formatted';
    name[key] = operation.value;
    draft.name = name;
  }
  return draft;
}

function normalizeGroup(body: unknown) {
  const value = requireRecord(body);
  const displayName = optionalString(value.displayName, 'displayName', 256);
  if (!displayName) {
    throw new ScimException(
      HttpStatus.BAD_REQUEST,
      'displayName is required',
      'invalidValue',
    );
  }
  return {
    displayName,
    normalizedDisplayName: normalizeScimText(displayName, 'displayName'),
    externalId: optionalString(value.externalId, 'externalId'),
    memberIds: memberIds(value.members),
  };
}

function groupDraft(group: ScimGroupRecord): Record<string, unknown> {
  return {
    displayName: group.displayName,
    externalId: group.externalId,
    members: group.members.map((member) => ({ value: member.userId })),
  };
}

function applyGroupPatch(
  draft: Record<string, unknown>,
  operation: ScimPatchOperation,
) {
  if (!operation.path) {
    if (operation.op === 'remove' || !isRecord(operation.value)) {
      throw invalidPath('A path is required unless add/replace value is an object');
    }
    for (const [path, value] of Object.entries(operation.value)) {
      draft = applyGroupPatch(draft, { ...operation, path, value });
    }
    return draft;
  }
  const memberFilter = operation.path.match(
    /^members\[value\s+eq\s+"([0-9a-f-]{36})"\]$/i,
  );
  const path = operation.path.toLowerCase();
  if (
    !memberFilter &&
    !['members', 'displayname', 'externalid'].includes(path)
  ) {
    throw invalidPath(`Unsupported group PATCH path ${operation.path}`);
  }
  if (operation.op === 'remove') {
    if (memberFilter) {
      draft.members = memberIds(draft.members)
        .filter((id) => id !== memberFilter[1])
        .map((value) => ({ value }));
    } else if (path === 'members') {
      const removals =
        operation.value === undefined ? [] : memberIds(operation.value);
      draft.members =
        removals.length === 0
          ? []
          : memberIds(draft.members)
              .filter((id) => !removals.includes(id))
              .map((value) => ({ value }));
    } else if (path === 'externalid') draft.externalId = null;
    else throw invalidPath('displayName cannot be removed');
    return draft;
  }
  if (path === 'members') {
    const incoming = memberIds(operation.value);
    const values =
      operation.op === 'add'
        ? [...new Set([...memberIds(draft.members), ...incoming])]
        : incoming;
    draft.members = values.map((value) => ({ value }));
  } else if (path === 'displayname') draft.displayName = operation.value;
  else if (path === 'externalid') draft.externalId = operation.value;
  return draft;
}

function parsePatch(body: unknown): ScimPatchOperation[] {
  const value = requireRecord(body);
  if (
    !Array.isArray(value.schemas) ||
    !value.schemas.includes(SCIM_PATCH_SCHEMA)
  ) {
    throw new ScimException(
      HttpStatus.BAD_REQUEST,
      `schemas must include ${SCIM_PATCH_SCHEMA}`,
      'invalidSyntax',
    );
  }
  if (
    !Array.isArray(value.Operations) ||
    value.Operations.length === 0 ||
    value.Operations.length > 100
  ) {
    throw new ScimException(
      HttpStatus.BAD_REQUEST,
      'Operations must contain between 1 and 100 entries',
      'invalidSyntax',
    );
  }
  return value.Operations.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.op !== 'string') {
      throw new ScimException(
        HttpStatus.BAD_REQUEST,
        `Operations[${index}] is invalid`,
        'invalidSyntax',
      );
    }
    const op = entry.op.toLowerCase();
    if (!['add', 'replace', 'remove'].includes(op)) {
      throw new ScimException(
        HttpStatus.BAD_REQUEST,
        `Operations[${index}].op is unsupported`,
        'invalidValue',
      );
    }
    if (entry.path !== undefined && typeof entry.path !== 'string') {
      throw invalidPath(`Operations[${index}].path must be a string`);
    }
    return {
      op: op as ScimPatchOperation['op'],
      path: entry.path,
      value: entry.value,
    };
  });
}

function memberIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10_000) {
    throw new ScimException(
      HttpStatus.BAD_REQUEST,
      'members must be an array with at most 10000 entries',
      'invalidValue',
    );
  }
  return value.map((entry, index) => {
    if (
      !isRecord(entry) ||
      typeof entry.value !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        entry.value,
      )
    ) {
      throw new ScimException(
        HttpStatus.BAD_REQUEST,
        `members[${index}].value must be a SCIM user UUID`,
        'invalidValue',
      );
    }
    return entry.value;
  });
}

function invalidPath(message: string) {
  return new ScimException(HttpStatus.BAD_REQUEST, message, 'invalidPath');
}

function sameUser(user: ScimUserRecord, input: NormalizedUser) {
  return (
    user.externalId === input.externalId &&
    user.userName === input.userName &&
    user.givenName === input.givenName &&
    user.familyName === input.familyName &&
    user.formattedName === input.formattedName &&
    stableJson(user.emails) === stableJson(input.emails) &&
    user.primaryEmail === input.primaryEmail &&
    user.active === input.active
  );
}

function sameGroup(
  group: ScimGroupRecord,
  input: ReturnType<typeof normalizeGroup>,
  memberValues: string[],
) {
  return (
    group.externalId === input.externalId &&
    group.displayName === input.displayName &&
    stableJson(group.members.map((member) => member.userId).sort()) ===
      stableJson([...memberValues].sort())
  );
}

function safeUserAudit(user: {
  active: boolean;
  externalId: string | null;
  version: number;
}) {
  return {
    active: user.active,
    hasExternalId: !!user.externalId,
    version: user.version,
  };
}

function auditMetadata(
  context: ScimContext,
  metadata?: Prisma.InputJsonValue,
): Prisma.InputJsonValue {
  return {
    connectionId: context.provisioningConnectionId,
    ...(isRecord(metadata) ? metadata : {}),
  };
}

function attribute(attributes: AttributeType[] | undefined, name: string) {
  return attributes?.find((entry) => entry.Name === name)?.Value;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function deterministicRole(roles: ApplicationRole[]) {
  const order: ApplicationRole[] = [
    'TENANT_ADMIN',
    'HR_ADMIN',
    'PAYROLL_ADMIN',
    'MANAGER',
    'AUDITOR',
    'EMPLOYEE',
  ];
  const values = new Set(roles);
  return order.find((role) => values.has(role)) ?? ApplicationRole.EMPLOYEE;
}

function isUniqueViolation(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function mapPersistenceError(error: unknown): unknown {
  if (isUniqueViolation(error)) {
    return new ScimException(
      HttpStatus.CONFLICT,
      'A resource with the same unique attribute already exists',
      'uniqueness',
    );
  }
  return error;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'unknown error';
}

function userSchema() {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'],
    id: SCIM_USER_SCHEMA,
    name: 'User',
    description: 'SCIM tenant user',
    attributes: [
      { name: 'userName', type: 'string', multiValued: false, required: true, uniqueness: 'server' },
      { name: 'externalId', type: 'string', multiValued: false, required: false, uniqueness: 'server' },
      { name: 'name', type: 'complex', multiValued: false, required: false },
      { name: 'emails', type: 'complex', multiValued: true, required: false },
      { name: 'active', type: 'boolean', multiValued: false, required: false },
    ],
  };
}

function groupSchema() {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'],
    id: SCIM_GROUP_SCHEMA,
    name: 'Group',
    description: 'SCIM tenant group',
    attributes: [
      { name: 'displayName', type: 'string', multiValued: false, required: true, uniqueness: 'server' },
      { name: 'externalId', type: 'string', multiValued: false, required: false, uniqueness: 'server' },
      { name: 'members', type: 'complex', multiValued: true, required: false },
    ],
  };
}
