-- Existing Cognito subject memberships remain available during the controlled migration.
ALTER TABLE "TenantMembership" ALTER COLUMN "cognitoSubject" DROP NOT NULL;

CREATE TYPE "IdentityConnectionType" AS ENUM ('SHARED_COGNITO', 'DEDICATED_COGNITO');
CREATE TYPE "IdentityConnectionStatus" AS ENUM ('ACTIVE', 'DISABLED');

CREATE TABLE "IdentityConnection" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "type" "IdentityConnectionType" NOT NULL,
    "status" "IdentityConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "issuer" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "authorizationEndpoint" TEXT NOT NULL,
    "tokenEndpoint" TEXT NOT NULL,
    "endSessionEndpoint" TEXT NOT NULL,
    "discoverySlug" TEXT,
    "verifiedDomains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY['openid', 'email', 'profile']::TEXT[],
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "clientSecretReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdentityConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalIdentity" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "tenantMembershipId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "providerSubject" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IdentityConnection_issuer_key" ON "IdentityConnection"("issuer");
CREATE UNIQUE INDEX "IdentityConnection_discoverySlug_key" ON "IdentityConnection"("discoverySlug");
CREATE INDEX "IdentityConnection_status_isDefault_idx" ON "IdentityConnection"("status", "isDefault");
CREATE INDEX "IdentityConnection_tenantId_status_idx" ON "IdentityConnection"("tenantId", "status");
CREATE UNIQUE INDEX "IdentityConnection_single_active_default_shared_key"
    ON "IdentityConnection"("isDefault")
    WHERE "isDefault" = true
      AND "status" = 'ACTIVE'
      AND "type" = 'SHARED_COGNITO';
CREATE UNIQUE INDEX "ExternalIdentity_connectionId_providerSubject_tenantId_key"
    ON "ExternalIdentity"("connectionId", "providerSubject", "tenantId");
CREATE UNIQUE INDEX "ExternalIdentity_tenantMembershipId_connectionId_key"
    ON "ExternalIdentity"("tenantMembershipId", "connectionId");
CREATE INDEX "ExternalIdentity_connectionId_providerSubject_idx"
    ON "ExternalIdentity"("connectionId", "providerSubject");
CREATE INDEX "ExternalIdentity_tenantId_tenantMembershipId_idx"
    ON "ExternalIdentity"("tenantId", "tenantMembershipId");

ALTER TABLE "IdentityConnection"
    ADD CONSTRAINT "IdentityConnection_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalIdentity"
    ADD CONSTRAINT "ExternalIdentity_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalIdentity"
    ADD CONSTRAINT "ExternalIdentity_tenantMembershipId_fkey"
    FOREIGN KEY ("tenantMembershipId") REFERENCES "TenantMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalIdentity"
    ADD CONSTRAINT "ExternalIdentity_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "IdentityConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "prevent_external_identity_reassignment"()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
       OR NEW."tenantMembershipId" IS DISTINCT FROM OLD."tenantMembershipId"
       OR NEW."connectionId" IS DISTINCT FROM OLD."connectionId"
       OR NEW."providerSubject" IS DISTINCT FROM OLD."providerSubject" THEN
        RAISE EXCEPTION 'External identity mappings are immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ExternalIdentity_prevent_reassignment"
BEFORE UPDATE ON "ExternalIdentity"
FOR EACH ROW EXECUTE FUNCTION "prevent_external_identity_reassignment"();
