import { Prisma, type PolicyScopeType, type PolicyVersion } from '@prisma/client';

/**
 * NOTE: this precedence-resolution algorithm is intentionally duplicated in
 * apps/api/src/policies/policy-resolution.ts (against PrismaService rather than a
 * transaction client). There is no shared source package between apps/api and
 * apps/worker today beyond @attendance/contracts (event schemas only), so this ~30-line
 * algorithm is implemented once per app rather than introducing a new shared package for
 * it. Mirrored unit test suites in both apps/worker/test/policy-resolution.spec.ts and
 * apps/api/test/policies.service.spec.ts guard against the two copies drifting apart.
 */

export interface PolicyRules {
  lateArrival: { graceMinutes: number };
  earlyDeparture: { graceMinutes: number };
  overtime: {
    thresholdMinutes: number;
    dailyCapMinutes: number | null;
    roundingMinutes: number;
  };
  halfDay: { halfDayThresholdMinutes: number };
  absence: { lop: boolean };
}

export interface PolicyScopeCandidate {
  scopeType: PolicyScopeType;
  scopeId: string;
}

export interface ResolvedPolicy {
  policyVersion: PolicyVersion;
  rules: PolicyRules;
  scopeType: PolicyScopeType;
  scopeId: string;
  scopeChainEvaluated: Array<PolicyScopeCandidate & { matched: boolean }>;
}

export class PolicyResolutionError extends Error {}

/**
 * Resolves the single, most-specific PUBLISHED PolicyVersion effective for a given
 * employee/date (whole-record override precedence: EMPLOYEE > EMPLOYEE_GROUP (ties broken
 * by higher EmployeeGroup.priority, then lower id) > DEPARTMENT > LOCATION > TENANT).
 * Throws PolicyResolutionError if even the TENANT scope has no match — this should be
 * unreachable given the tenant-default backfill/publish-time invariant, and is treated as
 * a hard data-integrity failure rather than a silent fallback.
 */
export async function resolveEffectivePolicy(
  client: Prisma.TransactionClient,
  tenantId: string,
  employeeId: string,
  workDate: Date,
): Promise<ResolvedPolicy> {
  const employee = await client.employee.findFirst({
    where: { id: employeeId, tenantId },
    select: {
      id: true,
      departmentId: true,
      locationId: true,
      groupMemberships: {
        select: { group: { select: { id: true, priority: true } } },
      },
    },
  });
  if (!employee) {
    throw new PolicyResolutionError(
      `Employee not found for policy resolution: ${employeeId}`,
    );
  }

  const candidates: PolicyScopeCandidate[] = [
    { scopeType: 'EMPLOYEE', scopeId: employee.id },
    ...employee.groupMemberships
      .map((membership) => membership.group)
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
      .map((group) => ({ scopeType: 'EMPLOYEE_GROUP' as const, scopeId: group.id })),
    ...(employee.departmentId
      ? [{ scopeType: 'DEPARTMENT' as const, scopeId: employee.departmentId }]
      : []),
    ...(employee.locationId
      ? [{ scopeType: 'LOCATION' as const, scopeId: employee.locationId }]
      : []),
    { scopeType: 'TENANT', scopeId: tenantId },
  ];

  const versions = await client.policyVersion.findMany({
    where: {
      tenantId,
      status: 'PUBLISHED',
      effectiveFrom: { lte: workDate },
      OR: candidates.map((candidate) => ({
        scopeType: candidate.scopeType,
        scopeId: candidate.scopeId,
      })),
    },
    orderBy: { effectiveFrom: 'desc' },
  });

  const bestByScope = new Map<string, (typeof versions)[number]>();
  for (const version of versions) {
    const key = `${version.scopeType}:${version.scopeId}`;
    if (!bestByScope.has(key)) bestByScope.set(key, version);
  }

  const scopeChainEvaluated = candidates.map((candidate) => ({
    ...candidate,
    matched: bestByScope.has(`${candidate.scopeType}:${candidate.scopeId}`),
  }));

  for (const candidate of candidates) {
    const hit = bestByScope.get(`${candidate.scopeType}:${candidate.scopeId}`);
    if (hit) {
      return {
        policyVersion: hit,
        rules: hit.rules as unknown as PolicyRules,
        scopeType: candidate.scopeType,
        scopeId: candidate.scopeId,
        scopeChainEvaluated,
      };
    }
  }

  throw new PolicyResolutionError(
    `No tenant-level policy version found for tenant ${tenantId} — data integrity violation`,
  );
}
