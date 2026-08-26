import {
  AdminCreateUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminGetUserCommand,
  AdminResetUserPasswordCommand,
  MessageActionType,
  UserNotFoundException,
  UsernameExistsException,
  type AttributeType,
  type UserStatusType,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApplicationRole, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  COGNITO_ADMIN_CLIENT_FACTORY,
  createCognitoAdminClient,
  type CognitoAdminClient,
  type CognitoAdminClientFactory,
} from './cognito-admin';
import { InviteTenantUserDto } from './dto/invite-tenant-user.dto';

interface ManagedConnection {
  id: string;
  type: 'SHARED_COGNITO' | 'DEDICATED_COGNITO';
  cognitoUserPoolId: string;
  awsRegion: string;
  mfaPolicy: 'OPTIONAL' | 'REQUIRED';
}

interface CognitoUserRecord {
  Username?: string;
  UserAttributes?: AttributeType[];
  UserStatus?: UserStatusType;
  Enabled?: boolean;
  UserMFASettingList?: string[];
}

@Injectable()
export class TenantUsersService {
  private readonly clients = new Map<string, CognitoAdminClient>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(COGNITO_ADMIN_CLIENT_FACTORY)
    private readonly clientFactory: CognitoAdminClientFactory =
      createCognitoAdminClient,
  ) {}

  async list(tenantId: string) {
    const memberships = await this.prisma.tenantMembership.findMany({
      where: { tenantId },
      select: {
        id: true,
        email: true,
        role: true,
        active: true,
        lifecycleStatus: true,
        mfaRequired: true,
        invitedAt: true,
        disabledAt: true,
        externalIdentities: {
          where: { connection: { status: 'ACTIVE' } },
          select: {
            providerUsername: true,
            connection: {
              select: {
                id: true,
                type: true,
                cognitoUserPoolId: true,
                awsRegion: true,
                mfaPolicy: true,
              },
            },
          },
          take: 1,
        },
        invitations: {
          orderBy: { lastSentAt: 'desc' },
          select: {
            status: true,
            lastSentAt: true,
            resendCount: true,
          },
          take: 1,
        },
      },
      orderBy: [{ email: 'asc' }, { createdAt: 'asc' }],
    });

    return Promise.all(
      memberships.map(async (membership) => {
        const identity = membership.externalIdentities[0];
        const cognito =
          identity?.providerUsername && identity.connection
            ? await this.getCognitoUser(
                identity.connection,
                identity.providerUsername,
              )
            : null;
        return {
          id: membership.id,
          email: membership.email,
          role: membership.role,
          active: membership.active,
          lifecycleStatus: membership.lifecycleStatus,
          mfaRequired: membership.mfaRequired,
          mfaEnforcedByPool:
            identity?.connection.mfaPolicy === 'REQUIRED',
          mfaStatus: this.mfaStatus(cognito),
          cognitoStatus: cognito?.UserStatus ?? (identity ? 'MISSING' : 'UNLINKED'),
          invitedAt: membership.invitedAt,
          disabledAt: membership.disabledAt,
          invitation: membership.invitations[0] ?? null,
        };
      }),
    );
  }

  async invite(
    tenantId: string,
    actorSubject: string,
    input: InviteTenantUserDto,
  ) {
    const email = input.email.trim().toLowerCase();
    const existing = await this.prisma.tenantMembership.findFirst({
      where: { tenantId, email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('A membership already exists for this email');
    }

    const connection = await this.connectionForTenant(tenantId);
    const mfaRequired =
      input.mfaRequired ?? connection.mfaPolicy === 'REQUIRED';
    this.assertMfaCanBeEnforced(connection, mfaRequired);
    const { user: cognito, invitationSent } =
      await this.createOrGetCognitoUser(connection, email, tenantId);
    const providerSubject = this.attribute(cognito, 'sub');
    if (!cognito.Username || !providerSubject) {
      throw new ServiceUnavailableException(
        'Cognito did not return an immutable user identity',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const membership = await tx.tenantMembership.create({
        data: {
          tenantId,
          email,
          role: input.role,
          active: true,
          lifecycleStatus: invitationSent ? 'INVITED' : 'ACTIVE',
          mfaRequired,
          invitedAt: invitationSent ? new Date() : null,
          externalIdentities: {
            create: {
              tenantId,
              connectionId: connection.id,
              providerSubject,
              providerUsername: cognito.Username,
            },
          },
        },
      });
      if (invitationSent) {
        await tx.userInvitation.create({
          data: {
            tenantId,
            tenantMembershipId: membership.id,
            connectionId: connection.id,
            email,
            createdBySubject: actorSubject,
          },
        });
      }
      await this.audit(tx, tenantId, actorSubject, invitationSent
        ? 'tenant_user.invited'
        : 'tenant_user.existing_identity_assigned', membership.id, {
        email,
        role: input.role,
        mfaRequired,
        connectionId: connection.id,
      });
      return membership;
    });
  }

  async assignRole(
    tenantId: string,
    membershipId: string,
    actorSubject: string,
    role: ApplicationRole,
  ) {
    const membership = await this.membership(tenantId, membershipId);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.tenantMembership.update({
        where: { id: membership.id },
        data: { role },
      });
      await this.audit(tx, tenantId, actorSubject, 'tenant_user.role_changed', membership.id, {
        from: membership.role,
        to: role,
      });
      return updated;
    });
  }

  async setMfaPolicy(
    tenantId: string,
    membershipId: string,
    actorSubject: string,
    required: boolean,
  ) {
    const managed = await this.managedMembership(tenantId, membershipId);
    this.assertMfaCanBeEnforced(managed.connection, required);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.tenantMembership.update({
        where: { id: managed.membership.id },
        data: { mfaRequired: required },
      });
      await this.audit(tx, tenantId, actorSubject, 'tenant_user.mfa_policy_changed', membershipId, {
        required,
        enforcedByPool: managed.connection.mfaPolicy === 'REQUIRED',
      });
      return updated;
    });
  }

  async disable(
    tenantId: string,
    membershipId: string,
    actorSubject: string,
  ) {
    const managed = await this.managedMembership(tenantId, membershipId);
    const otherActiveMemberships =
      managed.connection.type === 'SHARED_COGNITO'
        ? await this.prisma.externalIdentity.count({
            where: {
              connectionId: managed.connection.id,
              providerSubject: managed.providerSubject,
              tenantId: { not: tenantId },
              tenantMembership: { active: true },
            },
          })
        : 0;
    const disableCognito = otherActiveMemberships === 0;
    if (disableCognito) {
      await this.client(managed.connection.awsRegion).send(
        new AdminDisableUserCommand({
          UserPoolId: managed.connection.cognitoUserPoolId,
          Username: managed.providerUsername,
        }),
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.tenantMembership.update({
        where: { id: membershipId },
        data: {
          active: false,
          lifecycleStatus: 'DISABLED',
          disabledAt: new Date(),
        },
      });
      await this.audit(tx, tenantId, actorSubject, 'tenant_user.disabled', membershipId, {
        cognitoDisabled: disableCognito,
      });
      return updated;
    });
  }

  async enable(
    tenantId: string,
    membershipId: string,
    actorSubject: string,
  ) {
    const managed = await this.managedMembership(tenantId, membershipId);
    this.assertMfaCanBeEnforced(
      managed.connection,
      managed.membership.mfaRequired,
    );
    const cognito = await this.getCognitoUser(
      managed.connection,
      managed.providerUsername,
    );
    if (!cognito) {
      throw new NotFoundException('The Cognito user no longer exists');
    }
    if (cognito.Enabled === false) {
      await this.client(managed.connection.awsRegion).send(
        new AdminEnableUserCommand({
          UserPoolId: managed.connection.cognitoUserPoolId,
          Username: managed.providerUsername,
        }),
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.tenantMembership.update({
        where: { id: membershipId },
        data: {
          active: true,
          lifecycleStatus: 'ACTIVE',
          disabledAt: null,
        },
      });
      await this.audit(tx, tenantId, actorSubject, 'tenant_user.enabled', membershipId);
      return updated;
    });
  }

  async resendInvitation(
    tenantId: string,
    membershipId: string,
    actorSubject: string,
  ) {
    const invitation = await this.prisma.userInvitation.findFirst({
      where: { tenantId, tenantMembershipId: membershipId, status: 'SENT' },
      orderBy: { lastSentAt: 'desc' },
    });
    if (!invitation) {
      throw new BadRequestException('This user has no pending invitation');
    }
    const managed = await this.managedMembership(tenantId, membershipId);
    await this.assertAccountExclusive(managed, tenantId);
    await this.client(managed.connection.awsRegion).send(
      new AdminCreateUserCommand({
        UserPoolId: managed.connection.cognitoUserPoolId,
        Username: managed.providerUsername,
        MessageAction: MessageActionType.RESEND,
        DesiredDeliveryMediums: ['EMAIL'],
        ClientMetadata: { tenantId },
      }),
    );
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.userInvitation.update({
        where: { id: invitation.id },
        data: { lastSentAt: new Date(), resendCount: { increment: 1 } },
      });
      await this.audit(tx, tenantId, actorSubject, 'tenant_user.invitation_resent', membershipId, {
        resendCount: updated.resendCount,
      });
      return updated;
    });
  }

  async resetPassword(
    tenantId: string,
    membershipId: string,
    actorSubject: string,
  ) {
    const managed = await this.managedMembership(tenantId, membershipId);
    await this.assertAccountExclusive(managed, tenantId);
    await this.client(managed.connection.awsRegion).send(
      new AdminResetUserPasswordCommand({
        UserPoolId: managed.connection.cognitoUserPoolId,
        Username: managed.providerUsername,
      }),
    );
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.tenantMembership.update({
        where: { id: membershipId },
        data: { lifecycleStatus: 'PASSWORD_RESET_REQUIRED' },
      });
      await this.audit(tx, tenantId, actorSubject, 'tenant_user.password_reset_started', membershipId);
      return updated;
    });
  }

  private async connectionForTenant(tenantId: string): Promise<ManagedConnection> {
    const dedicated = await this.prisma.identityConnection.findFirst({
      where: {
        tenantId,
        type: 'DEDICATED_COGNITO',
        status: 'ACTIVE',
        tenant: { status: 'ACTIVE' },
      },
      select: {
        id: true,
        type: true,
        cognitoUserPoolId: true,
        awsRegion: true,
        mfaPolicy: true,
      },
    });
    if (dedicated) return dedicated;
    const shared = await this.prisma.identityConnection.findFirst({
      where: {
        type: 'SHARED_COGNITO',
        status: 'ACTIVE',
        isDefault: true,
      },
      select: {
        id: true,
        type: true,
        cognitoUserPoolId: true,
        awsRegion: true,
        mfaPolicy: true,
      },
    });
    if (!shared) {
      throw new ServiceUnavailableException('No active identity connection is configured');
    }
    return shared;
  }

  private async membership(tenantId: string, membershipId: string) {
    const membership = await this.prisma.tenantMembership.findFirst({
      where: { id: membershipId, tenantId },
      select: { id: true, role: true, mfaRequired: true },
    });
    if (!membership) throw new NotFoundException('Tenant user was not found');
    return membership;
  }

  private async managedMembership(tenantId: string, membershipId: string) {
    const membership = await this.prisma.tenantMembership.findFirst({
      where: { id: membershipId, tenantId },
      select: {
        id: true,
        role: true,
        mfaRequired: true,
        externalIdentities: {
          where: { connection: { status: 'ACTIVE' } },
          select: {
            providerUsername: true,
            providerSubject: true,
            connection: {
              select: {
                id: true,
                type: true,
                cognitoUserPoolId: true,
                awsRegion: true,
                mfaPolicy: true,
              },
            },
          },
          take: 1,
        },
      },
    });
    const identity = membership?.externalIdentities[0];
    if (!membership || !identity?.providerUsername) {
      throw new NotFoundException('Tenant user has no active managed identity');
    }
    return {
      membership,
      providerUsername: identity.providerUsername,
      providerSubject: identity.providerSubject,
      connection: identity.connection,
    };
  }

  private async createOrGetCognitoUser(
    connection: ManagedConnection,
    email: string,
    tenantId: string,
  ): Promise<{ user: CognitoUserRecord; invitationSent: boolean }> {
    const client = this.client(connection.awsRegion);
    try {
      const result = await client.send(
        new AdminCreateUserCommand({
          UserPoolId: connection.cognitoUserPoolId,
          Username: email,
          UserAttributes: [
            { Name: 'email', Value: email },
          ],
          DesiredDeliveryMediums: ['EMAIL'],
          ClientMetadata: { tenantId },
        }),
      );
      return {
        invitationSent: true,
        user: {
          Username: result.User?.Username,
          UserAttributes: result.User?.Attributes,
          UserStatus: result.User?.UserStatus,
          Enabled: result.User?.Enabled,
        },
      };
    } catch (error: unknown) {
      if (!(error instanceof UsernameExistsException)) throw error;
      return {
        invitationSent: false,
        user: await client.send(
          new AdminGetUserCommand({
            UserPoolId: connection.cognitoUserPoolId,
            Username: email,
          }),
        ),
      };
    }
  }

  private async getCognitoUser(
    connection: ManagedConnection,
    providerUsername: string,
  ): Promise<CognitoUserRecord | null> {
    try {
      return await this.client(connection.awsRegion).send(
        new AdminGetUserCommand({
          UserPoolId: connection.cognitoUserPoolId,
          Username: providerUsername,
        }),
      );
    } catch (error: unknown) {
      if (error instanceof UserNotFoundException) return null;
      throw error;
    }
  }

  private attribute(user: CognitoUserRecord, name: string) {
    return user.UserAttributes?.find((attribute) => attribute.Name === name)?.Value;
  }

  private mfaStatus(user: CognitoUserRecord | null) {
    if (!user) return 'UNKNOWN';
    return user.UserMFASettingList?.includes('SOFTWARE_TOKEN_MFA')
      ? 'TOTP_ENABLED'
      : 'NOT_ENROLLED';
  }

  private assertMfaCanBeEnforced(
    connection: ManagedConnection,
    required: boolean,
  ): void {
    if (required && connection.mfaPolicy !== 'REQUIRED') {
      throw new BadRequestException(
        'This identity connection does not enforce MFA for every login',
      );
    }
  }

  private async assertAccountExclusive(
    managed: {
      connection: ManagedConnection;
      providerSubject: string;
    },
    tenantId: string,
  ): Promise<void> {
    if (managed.connection.type === 'DEDICATED_COGNITO') return;
    const otherTenantMappings = await this.prisma.externalIdentity.count({
      where: {
        connectionId: managed.connection.id,
        providerSubject: managed.providerSubject,
        tenantId: { not: tenantId },
      },
    });
    if (otherTenantMappings > 0) {
      throw new ConflictException(
        'This shared identity belongs to multiple tenants; account-wide recovery must be handled by a platform administrator',
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
        entityType: 'TenantMembership',
        entityId,
        metadata,
      },
    });
  }
}
