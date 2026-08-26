CREATE TABLE "ScimProvisioningConnection" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "samlConnectionId" UUID NOT NULL,
    "identityConnectionId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultRole" "ApplicationRole" NOT NULL DEFAULT 'EMPLOYEE',
    "privilegedRolePolicy" BOOLEAN NOT NULL DEFAULT false,
    "enabledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScimProvisioningConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScimCredential" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "provisioningConnectionId" UUID NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenSalt" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "lastUsedIp" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdBySubject" TEXT NOT NULL,
    "revokedBySubject" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScimCredential_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScimUser" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "provisioningConnectionId" UUID NOT NULL,
    "identityConnectionId" UUID NOT NULL,
    "tenantMembershipId" UUID NOT NULL,
    "externalIdentityId" UUID NOT NULL,
    "externalId" TEXT,
    "userName" TEXT NOT NULL,
    "normalizedUserName" TEXT NOT NULL,
    "givenName" TEXT,
    "familyName" TEXT,
    "formattedName" TEXT,
    "emails" JSONB NOT NULL,
    "primaryEmail" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScimUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScimGroup" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "provisioningConnectionId" UUID NOT NULL,
    "externalId" TEXT,
    "displayName" TEXT NOT NULL,
    "normalizedDisplayName" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScimGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScimGroupMember" (
    "tenantId" UUID NOT NULL,
    "provisioningConnectionId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScimGroupMember_pkey" PRIMARY KEY ("groupId","userId")
);

CREATE TABLE "ScimGroupRoleMapping" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "provisioningConnectionId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "role" "ApplicationRole" NOT NULL,
    "privilegedConfirmedAt" TIMESTAMP(3),
    "privilegedConfirmedBy" TEXT,
    "createdBySubject" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScimGroupRoleMapping_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScimIdempotencyRecord" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "provisioningConnectionId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "requestPath" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScimIdempotencyRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScimProvisioningConnection_samlConnectionId_key" ON "ScimProvisioningConnection"("samlConnectionId");
CREATE UNIQUE INDEX "TenantMembership_id_tenantId_key" ON "TenantMembership"("id", "tenantId");
CREATE UNIQUE INDEX "SamlConnection_id_tenantId_identityConnectionId_key" ON "SamlConnection"("id", "tenantId", "identityConnectionId");
CREATE UNIQUE INDEX "ExternalIdentity_id_tenantId_tenantMembershipId_connectionId_key" ON "ExternalIdentity"("id", "tenantId", "tenantMembershipId", "connectionId");
CREATE UNIQUE INDEX "ScimProvisioningConnection_id_tenantId_key" ON "ScimProvisioningConnection"("id", "tenantId");
CREATE UNIQUE INDEX "ScimProvisioningConnection_id_tenantId_identityConnectionId_key" ON "ScimProvisioningConnection"("id", "tenantId", "identityConnectionId");
CREATE UNIQUE INDEX "ScimProvisioningConnection_samlConnectionId_tenantId_identityConnectionId_key" ON "ScimProvisioningConnection"("samlConnectionId", "tenantId", "identityConnectionId");
CREATE INDEX "ScimProvisioningConnection_tenantId_enabled_idx" ON "ScimProvisioningConnection"("tenantId", "enabled");
CREATE INDEX "ScimProvisioningConnection_identityConnectionId_enabled_idx" ON "ScimProvisioningConnection"("identityConnectionId", "enabled");
CREATE UNIQUE INDEX "ScimCredential_provisioningConnectionId_tokenPrefix_key" ON "ScimCredential"("provisioningConnectionId", "tokenPrefix");
CREATE INDEX "ScimCredential_tenantId_provisioningConnectionId_revokedAt_idx" ON "ScimCredential"("tenantId", "provisioningConnectionId", "revokedAt");
CREATE INDEX "ScimCredential_expiresAt_idx" ON "ScimCredential"("expiresAt");
CREATE UNIQUE INDEX "ScimUser_externalIdentityId_key" ON "ScimUser"("externalIdentityId");
CREATE UNIQUE INDEX "ScimUser_id_tenantId_provisioningConnectionId_key" ON "ScimUser"("id", "tenantId", "provisioningConnectionId");
CREATE UNIQUE INDEX "ScimUser_provisioningConnectionId_normalizedUserName_key" ON "ScimUser"("provisioningConnectionId", "normalizedUserName");
CREATE UNIQUE INDEX "ScimUser_provisioningConnectionId_externalId_key" ON "ScimUser"("provisioningConnectionId", "externalId");
CREATE UNIQUE INDEX "ScimUser_provisioningConnectionId_tenantMembershipId_key" ON "ScimUser"("provisioningConnectionId", "tenantMembershipId");
CREATE UNIQUE INDEX "ScimUser_externalIdentityId_tenantId_tenantMembershipId_identityConnectionId_key" ON "ScimUser"("externalIdentityId", "tenantId", "tenantMembershipId", "identityConnectionId");
CREATE INDEX "ScimUser_tenantId_provisioningConnectionId_active_idx" ON "ScimUser"("tenantId", "provisioningConnectionId", "active");
CREATE INDEX "ScimUser_tenantMembershipId_idx" ON "ScimUser"("tenantMembershipId");
CREATE UNIQUE INDEX "ScimGroup_id_tenantId_provisioningConnectionId_key" ON "ScimGroup"("id", "tenantId", "provisioningConnectionId");
CREATE UNIQUE INDEX "ScimGroup_provisioningConnectionId_normalizedDisplayName_key" ON "ScimGroup"("provisioningConnectionId", "normalizedDisplayName");
CREATE UNIQUE INDEX "ScimGroup_provisioningConnectionId_externalId_key" ON "ScimGroup"("provisioningConnectionId", "externalId");
CREATE INDEX "ScimGroup_tenantId_provisioningConnectionId_idx" ON "ScimGroup"("tenantId", "provisioningConnectionId");
CREATE INDEX "ScimGroupMember_tenantId_provisioningConnectionId_userId_idx" ON "ScimGroupMember"("tenantId", "provisioningConnectionId", "userId");
CREATE UNIQUE INDEX "ScimGroupRoleMapping_groupId_key" ON "ScimGroupRoleMapping"("groupId");
CREATE UNIQUE INDEX "ScimGroupRoleMapping_groupId_tenantId_provisioningConnectionId_key" ON "ScimGroupRoleMapping"("groupId", "tenantId", "provisioningConnectionId");
CREATE INDEX "ScimGroupRoleMapping_tenantId_provisioningConnectionId_role_idx" ON "ScimGroupRoleMapping"("tenantId", "provisioningConnectionId", "role");
CREATE UNIQUE INDEX "ScimIdempotencyRecord_provisioningConnectionId_idempotencyKey_key" ON "ScimIdempotencyRecord"("provisioningConnectionId", "idempotencyKey");
CREATE INDEX "ScimIdempotencyRecord_expiresAt_idx" ON "ScimIdempotencyRecord"("expiresAt");

ALTER TABLE "ScimProvisioningConnection" ADD CONSTRAINT "ScimProvisioningConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScimProvisioningConnection" ADD CONSTRAINT "ScimProvisioningConnection_samlConnectionId_tenantId_identityConnectionId_fkey" FOREIGN KEY ("samlConnectionId", "tenantId", "identityConnectionId") REFERENCES "SamlConnection"("id", "tenantId", "identityConnectionId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScimProvisioningConnection" ADD CONSTRAINT "ScimProvisioningConnection_identityConnectionId_fkey" FOREIGN KEY ("identityConnectionId") REFERENCES "IdentityConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScimCredential" ADD CONSTRAINT "ScimCredential_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScimCredential" ADD CONSTRAINT "ScimCredential_provisioningConnectionId_tenantId_fkey" FOREIGN KEY ("provisioningConnectionId", "tenantId") REFERENCES "ScimProvisioningConnection"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScimUser" ADD CONSTRAINT "ScimUser_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScimUser" ADD CONSTRAINT "ScimUser_provisioningConnectionId_tenantId_identityConnectionId_fkey" FOREIGN KEY ("provisioningConnectionId", "tenantId", "identityConnectionId") REFERENCES "ScimProvisioningConnection"("id", "tenantId", "identityConnectionId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScimUser" ADD CONSTRAINT "ScimUser_tenantMembershipId_tenantId_fkey" FOREIGN KEY ("tenantMembershipId", "tenantId") REFERENCES "TenantMembership"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScimUser" ADD CONSTRAINT "ScimUser_externalIdentityId_tenantId_tenantMembershipId_identityConnectionId_fkey" FOREIGN KEY ("externalIdentityId", "tenantId", "tenantMembershipId", "identityConnectionId") REFERENCES "ExternalIdentity"("id", "tenantId", "tenantMembershipId", "connectionId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScimGroup" ADD CONSTRAINT "ScimGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScimGroup" ADD CONSTRAINT "ScimGroup_provisioningConnectionId_tenantId_fkey" FOREIGN KEY ("provisioningConnectionId", "tenantId") REFERENCES "ScimProvisioningConnection"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScimGroupMember" ADD CONSTRAINT "ScimGroupMember_groupId_tenantId_provisioningConnectionId_fkey" FOREIGN KEY ("groupId", "tenantId", "provisioningConnectionId") REFERENCES "ScimGroup"("id", "tenantId", "provisioningConnectionId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScimGroupMember" ADD CONSTRAINT "ScimGroupMember_userId_tenantId_provisioningConnectionId_fkey" FOREIGN KEY ("userId", "tenantId", "provisioningConnectionId") REFERENCES "ScimUser"("id", "tenantId", "provisioningConnectionId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScimGroupRoleMapping" ADD CONSTRAINT "ScimGroupRoleMapping_provisioningConnectionId_tenantId_fkey" FOREIGN KEY ("provisioningConnectionId", "tenantId") REFERENCES "ScimProvisioningConnection"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScimGroupRoleMapping" ADD CONSTRAINT "ScimGroupRoleMapping_groupId_tenantId_provisioningConnectionId_fkey" FOREIGN KEY ("groupId", "tenantId", "provisioningConnectionId") REFERENCES "ScimGroup"("id", "tenantId", "provisioningConnectionId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScimIdempotencyRecord" ADD CONSTRAINT "ScimIdempotencyRecord_provisioningConnectionId_tenantId_fkey" FOREIGN KEY ("provisioningConnectionId", "tenantId") REFERENCES "ScimProvisioningConnection"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScimCredential" ADD CONSTRAINT "ScimCredential_prefix_length" CHECK (char_length("tokenPrefix") BETWEEN 8 AND 24);
ALTER TABLE "ScimUser" ADD CONSTRAINT "ScimUser_version_positive" CHECK ("version" > 0);
ALTER TABLE "ScimGroup" ADD CONSTRAINT "ScimGroup_version_positive" CHECK ("version" > 0);
