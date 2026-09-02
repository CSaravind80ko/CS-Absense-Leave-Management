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

async function seedAttendanceDemo(tenantId: string): Promise<void> {
  if (process.env.SEED_ATTENDANCE_DEMO !== 'true') return;

  const department = await prisma.department.upsert({
    where: { tenantId_code: { tenantId, code: 'OPS' } },
    update: { name: 'Operations' },
    create: { tenantId, code: 'OPS', name: 'Operations' },
  });
  const location = await prisma.location.upsert({
    where: { tenantId_code: { tenantId, code: 'HQ' } },
    update: { name: 'Head Office', timezone: 'Asia/Kolkata' },
    create: {
      tenantId,
      code: 'HQ',
      name: 'Head Office',
      timezone: 'Asia/Kolkata',
    },
  });
  const shift = await prisma.shift.upsert({
    where: { tenantId_code: { tenantId, code: 'GENERAL' } },
    update: {
      name: 'General Shift',
      startMinutes: 570,
      endMinutes: 1080,
      breakMinutes: 30,
    },
    create: {
      tenantId,
      locationId: location.id,
      code: 'GENERAL',
      name: 'General Shift',
      startMinutes: 570,
      endMinutes: 1080,
      breakMinutes: 30,
      graceMinutes: 10,
    },
  });
  const employees = await Promise.all(
    [
      ['DEMO-1001', 'Asha', 'Menon', 'asha.demo@example.com'],
      ['DEMO-1002', 'Ravi', 'Patel', 'ravi.demo@example.com'],
      ['DEMO-1003', 'Meera', 'Nair', 'meera.demo@example.com'],
    ].map(([employeeNumber, firstName, lastName, employeeEmail]) =>
      prisma.employee.upsert({
        where: { tenantId_employeeNumber: { tenantId, employeeNumber } },
        update: {
          firstName,
          lastName,
          email: employeeEmail,
          departmentId: department.id,
          locationId: location.id,
          shiftId: shift.id,
          status: 'ACTIVE',
        },
        create: {
          tenantId,
          employeeNumber,
          firstName,
          lastName,
          email: employeeEmail,
          departmentId: department.id,
          locationId: location.id,
          shiftId: shift.id,
        },
      }),
    ),
  );
  const startsOn = new Date(
    process.env.SEED_ATTENDANCE_PERIOD_START ?? '2026-08-01',
  );
  const endsOn = new Date(
    process.env.SEED_ATTENDANCE_PERIOD_END ?? '2026-08-31',
  );
  const period = await prisma.processingPeriod.upsert({
    where: { tenantId_startsOn_endsOn: { tenantId, startsOn, endsOn } },
    update: { name: 'Demo attendance period', status: 'REVIEW' },
    create: {
      tenantId,
      name: 'Demo attendance period',
      startsOn,
      endsOn,
      status: 'REVIEW',
    },
  });
  const workDate = new Date(startsOn);
  workDate.setUTCDate(Math.min(12, endsOn.getUTCDate()));
  const days = await Promise.all(
    employees.map((employee, index) =>
      prisma.attendanceDay.upsert({
        where: {
          tenantId_employeeId_workDate: {
            tenantId,
            employeeId: employee.id,
            workDate,
          },
        },
        update: {
          periodId: period.id,
          status: index === 2 ? 'PARTIAL' : 'PRESENT',
          scheduledMinutes: 480,
          workedMinutes: index === 2 ? 250 : 500 - index * 15,
          firstPunchAt: new Date(`${workDate.toISOString().slice(0, 10)}T04:05:00Z`),
          lastPunchAt:
            index === 2
              ? null
              : new Date(`${workDate.toISOString().slice(0, 10)}T12:35:00Z`),
          sourceSummary: { sources: ['DEMO_FIXTURE'], deterministic: true },
        },
        create: {
          tenantId,
          periodId: period.id,
          employeeId: employee.id,
          workDate,
          status: index === 2 ? 'PARTIAL' : 'PRESENT',
          scheduledMinutes: 480,
          workedMinutes: index === 2 ? 250 : 500 - index * 15,
          firstPunchAt: new Date(`${workDate.toISOString().slice(0, 10)}T04:05:00Z`),
          lastPunchAt:
            index === 2
              ? undefined
              : new Date(`${workDate.toISOString().slice(0, 10)}T12:35:00Z`),
          sourceSummary: { sources: ['DEMO_FIXTURE'], deterministic: true },
        },
      }),
    ),
  );
  for (const [index, employee] of employees.entries()) {
    await prisma.attendancePunch.upsert({
      where: {
        tenantId_source_externalId: {
          tenantId,
          source: 'DEMO_FIXTURE',
          externalId: `${employee.employeeNumber}-in`,
        },
      },
      update: {},
      create: {
        tenantId,
        employeeId: employee.id,
        locationId: location.id,
        occurredAt: new Date(`${workDate.toISOString().slice(0, 10)}T04:05:00Z`),
        type: 'IN',
        source: 'DEMO_FIXTURE',
        externalId: `${employee.employeeNumber}-in`,
        metadata: { deterministic: true, fixtureIndex: index },
      },
    });
  }
  const exceptionId = 'd9a168c4-2f21-4fd5-b0a0-2fa85aa82101';
  await prisma.attendanceException.upsert({
    where: { id: exceptionId },
    update: {
      tenantId,
      attendanceDayId: days[2].id,
      employeeId: employees[2].id,
      status: 'OPEN',
      severity: 'CRITICAL',
      payrollImpact: 'BLOCKED',
      details: { message: 'Missing punch-out in deterministic demo fixture' },
      assignedToRole: 'HR_ADMIN',
    },
    create: {
      id: exceptionId,
      tenantId,
      attendanceDayId: days[2].id,
      employeeId: employees[2].id,
      type: 'MISSING_PUNCH',
      severity: 'CRITICAL',
      payrollImpact: 'BLOCKED',
      details: { message: 'Missing punch-out in deterministic demo fixture' },
      assignedToRole: 'HR_ADMIN',
    },
  });
  const approvalId = '2a284881-215b-476a-b88b-eed49f7f5801';
  await prisma.approvalRequest.upsert({
    where: { id: approvalId },
    update: {
      tenantId,
      exceptionId,
      status: 'PENDING',
      assigneeRole: 'HR_ADMIN',
    },
    create: {
      id: approvalId,
      tenantId,
      type: 'EXCEPTION',
      exceptionId,
      requestedBy: 'attendance-demo-seed',
      assigneeRole: 'HR_ADMIN',
      actions: {
        create: {
          tenantId,
          action: 'SUBMITTED',
          actorSubject: 'attendance-demo-seed',
          comment: 'Deterministic local workflow fixture',
        },
      },
    },
  });
  console.info(`Seeded deterministic attendance workflow for ${period.name}`);
}

const DEMO_POLICY_VERSION_ID = 'b6a6f0b0-6f7a-4b8a-9e7c-9b1e6d2b7a01';
const DEMO_EMPLOYEE_GROUP_HOLIDAY_ID = '7e3f9b3e-3a0e-4a5c-9c7d-5c3e2f8b9a02';

async function seedPolicyEngineDemo(tenantId: string): Promise<void> {
  if (process.env.SEED_POLICY_ENGINE_DEMO !== 'true') return;

  const group = await prisma.employeeGroup.upsert({
    where: { tenantId_code: { tenantId, code: 'DEMO-FLEX' } },
    update: { name: 'Demo Flexible Group', priority: 10 },
    create: {
      tenantId,
      code: 'DEMO-FLEX',
      name: 'Demo Flexible Group',
      priority: 10,
    },
  });

  const members = await prisma.employee.findMany({
    where: { tenantId },
    orderBy: { employeeNumber: 'asc' },
    take: 2,
  });
  for (const employee of members) {
    await prisma.employeeGroupMember.upsert({
      where: {
        groupId_employeeId: { groupId: group.id, employeeId: employee.id },
      },
      update: {},
      create: { tenantId, groupId: group.id, employeeId: employee.id },
    });
  }

  await prisma.policyVersion.upsert({
    where: { id: DEMO_POLICY_VERSION_ID },
    update: {
      tenantId,
      scopeType: 'EMPLOYEE_GROUP',
      scopeId: group.id,
      status: 'PUBLISHED',
      name: 'Demo Flexible Policy',
      effectiveFrom: new Date('2026-08-01'),
      workingWeekdays: [1, 2, 3, 4, 5],
      rules: {
        lateArrival: { graceMinutes: 30 },
        earlyDeparture: { graceMinutes: 30 },
        overtime: { thresholdMinutes: 15, dailyCapMinutes: 240, roundingMinutes: 15 },
        halfDay: { halfDayThresholdMinutes: 240 },
        absence: { lop: true },
      },
      publishedAt: new Date(),
      publishedBy: 'system:seed',
    },
    create: {
      id: DEMO_POLICY_VERSION_ID,
      tenantId,
      scopeType: 'EMPLOYEE_GROUP',
      scopeId: group.id,
      status: 'PUBLISHED',
      name: 'Demo Flexible Policy',
      effectiveFrom: new Date('2026-08-01'),
      workingWeekdays: [1, 2, 3, 4, 5],
      rules: {
        lateArrival: { graceMinutes: 30 },
        earlyDeparture: { graceMinutes: 30 },
        overtime: { thresholdMinutes: 15, dailyCapMinutes: 240, roundingMinutes: 15 },
        halfDay: { halfDayThresholdMinutes: 240 },
        absence: { lop: true },
      },
      publishedAt: new Date(),
      publishedBy: 'system:seed',
      createdBy: 'system:seed',
    },
  });

  await prisma.holiday.upsert({
    where: { id: DEMO_EMPLOYEE_GROUP_HOLIDAY_ID },
    update: { tenantId, date: new Date('2026-08-15'), name: 'Independence Day' },
    create: {
      id: DEMO_EMPLOYEE_GROUP_HOLIDAY_ID,
      tenantId,
      date: new Date('2026-08-15'),
      name: 'Independence Day',
    },
  });

  console.info(`Seeded policy engine demo (group ${group.name})`);
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

  await seedAttendanceDemo(tenant.id);
  await seedPolicyEngineDemo(tenant.id);
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
