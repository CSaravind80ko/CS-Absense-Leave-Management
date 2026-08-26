import { ApplicationRole, PrismaClient } from '@prisma/client';

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

  const tenant = await prisma.tenant.upsert({
    where: { slug: tenantSlug },
    update: { name: tenantName, status: 'ACTIVE' },
    create: { name: tenantName, slug: tenantSlug },
  });

  await prisma.tenantMembership.upsert({
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
