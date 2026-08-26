import {
  ApplicationRole,
  IdentityConnectionType,
  PrismaClient,
} from '@prisma/client';

const prisma = new PrismaClient();

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required to seed the database`);
  return value;
}

async function main(): Promise<void> {
  const tenantName = required('SEED_TENANT_NAME');
  const tenantSlug = required('SEED_TENANT_SLUG');
  const cognitoSubject = required('SEED_ADMIN_COGNITO_SUBJECT');
  const email = required('SEED_ADMIN_EMAIL');
  const issuer = required('SEED_IDENTITY_ISSUER').replace(/\/$/, '');
  const clientId = required('SEED_IDENTITY_CLIENT_ID');
  const hostedUiDomain = required('SEED_IDENTITY_HOSTED_UI_DOMAIN').replace(
    /\/$/,
    '',
  );
  const issuerParts = new URL(issuer);
  const awsRegion = issuerParts.hostname.split('.')[1];
  const cognitoUserPoolId = issuerParts.pathname.replace(/^\//, '');
  const mfaPolicy =
    process.env.SEED_IDENTITY_MFA_POLICY === 'REQUIRED'
      ? 'REQUIRED'
      : 'OPTIONAL';
  if (!awsRegion || !cognitoUserPoolId) {
    throw new Error('SEED_IDENTITY_ISSUER is not a Cognito user-pool issuer');
  }

  const tenant = await prisma.tenant.upsert({
    where: { slug: tenantSlug },
    update: { name: tenantName, status: 'ACTIVE' },
    create: { name: tenantName, slug: tenantSlug },
  });

  const connection = await prisma.identityConnection.upsert({
    where: { issuer },
    update: {
      clientId,
      authorizationEndpoint: `${hostedUiDomain}/oauth2/authorize`,
      tokenEndpoint: `${hostedUiDomain}/oauth2/token`,
      endSessionEndpoint: `${hostedUiDomain}/logout`,
      status: 'ACTIVE',
      isDefault: true,
      awsRegion,
      cognitoUserPoolId,
      mfaPolicy,
    },
    create: {
      type: IdentityConnectionType.SHARED_COGNITO,
      issuer,
      clientId,
      authorizationEndpoint: `${hostedUiDomain}/oauth2/authorize`,
      tokenEndpoint: `${hostedUiDomain}/oauth2/token`,
      endSessionEndpoint: `${hostedUiDomain}/logout`,
      isDefault: true,
      awsRegion,
      cognitoUserPoolId,
      mfaPolicy,
    },
  });

  const membership = await prisma.tenantMembership.upsert({
    where: {
      tenantId_cognitoSubject: {
        tenantId: tenant.id,
        cognitoSubject,
      },
    },
    update: { email, role: ApplicationRole.HR_ADMIN, active: true },
    create: {
      tenantId: tenant.id,
      cognitoSubject,
      email,
      role: ApplicationRole.HR_ADMIN,
    },
  });

  await prisma.externalIdentity.upsert({
    where: {
      connectionId_providerSubject_tenantId: {
        connectionId: connection.id,
        providerSubject: cognitoSubject,
        providerUsername: email,
        tenantId: tenant.id,
      },
    },
    update: { providerUsername: email },
    create: {
      connectionId: connection.id,
      providerSubject: cognitoSubject,
      tenantId: tenant.id,
      tenantMembershipId: membership.id,
    },
  });

  console.info(`Seeded HR administrator membership for tenant ${tenant.slug}`);
}

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
