CREATE TYPE "SamlConnectionStatus" AS ENUM (
    'DRAFT',
    'METADATA_VALID',
    'PROVISIONING',
    'READY',
    'ACTIVE',
    'DISABLED',
    'ERROR'
);

CREATE TABLE "SamlConnection" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "identityConnectionId" UUID NOT NULL,
    "entityId" TEXT,
    "metadataUrl" TEXT,
    "metadataReference" TEXT,
    "certificateFingerprints" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "certificateDetails" JSONB,
    "cognitoProviderName" TEXT NOT NULL,
    "attributeMapping" JSONB NOT NULL,
    "status" "SamlConnectionStatus" NOT NULL DEFAULT 'DRAFT',
    "metadataValidatedAt" TIMESTAMP(3),
    "provisionedAt" TIMESTAMP(3),
    "testedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "testResult" JSONB,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SamlConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SamlConnection_tenantId_identityConnectionId_key"
    ON "SamlConnection"("tenantId", "identityConnectionId");
CREATE UNIQUE INDEX "SamlConnection_identityConnectionId_cognitoProviderName_key"
    ON "SamlConnection"("identityConnectionId", "cognitoProviderName");
CREATE INDEX "SamlConnection_tenantId_status_idx"
    ON "SamlConnection"("tenantId", "status");

ALTER TABLE "SamlConnection"
    ADD CONSTRAINT "SamlConnection_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SamlConnection"
    ADD CONSTRAINT "SamlConnection_identityConnectionId_fkey"
    FOREIGN KEY ("identityConnectionId") REFERENCES "IdentityConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
