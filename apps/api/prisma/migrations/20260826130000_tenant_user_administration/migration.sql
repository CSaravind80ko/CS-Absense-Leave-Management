CREATE TYPE "IdentityMfaPolicy" AS ENUM ('OPTIONAL', 'REQUIRED');
CREATE TYPE "TenantUserStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED', 'PASSWORD_RESET_REQUIRED');
CREATE TYPE "UserInvitationStatus" AS ENUM ('SENT', 'ACCEPTED', 'EXPIRED', 'CANCELLED');

ALTER TABLE "IdentityConnection"
    ADD COLUMN "cognitoUserPoolId" TEXT,
    ADD COLUMN "awsRegion" TEXT,
    ADD COLUMN "mfaPolicy" "IdentityMfaPolicy" NOT NULL DEFAULT 'OPTIONAL';

UPDATE "IdentityConnection"
SET
    "awsRegion" = split_part(split_part("issuer", 'cognito-idp.', 2), '.', 1),
    "cognitoUserPoolId" = split_part("issuer", '/', 4);

ALTER TABLE "IdentityConnection"
    ALTER COLUMN "cognitoUserPoolId" SET NOT NULL,
    ALTER COLUMN "awsRegion" SET NOT NULL;

ALTER TABLE "TenantMembership"
    ADD COLUMN "lifecycleStatus" "TenantUserStatus" NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN "mfaRequired" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "invitedAt" TIMESTAMP(3),
    ADD COLUMN "disabledAt" TIMESTAMP(3);

ALTER TABLE "ExternalIdentity" ADD COLUMN "providerUsername" TEXT;

CREATE TABLE "UserInvitation" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "tenantMembershipId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "status" "UserInvitationStatus" NOT NULL DEFAULT 'SENT',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resendCount" INTEGER NOT NULL DEFAULT 0,
    "acceptedAt" TIMESTAMP(3),
    "createdBySubject" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserInvitation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserInvitation_tenantId_status_idx" ON "UserInvitation"("tenantId", "status");
CREATE INDEX "UserInvitation_tenantMembershipId_status_idx" ON "UserInvitation"("tenantMembershipId", "status");

ALTER TABLE "UserInvitation"
    ADD CONSTRAINT "UserInvitation_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserInvitation"
    ADD CONSTRAINT "UserInvitation_tenantMembershipId_fkey"
    FOREIGN KEY ("tenantMembershipId") REFERENCES "TenantMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserInvitation"
    ADD CONSTRAINT "UserInvitation_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "IdentityConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
