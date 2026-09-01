import type { Prisma } from '@prisma/client';
import {
  resolveEffectivePolicy,
  PolicyResolutionError,
} from '../src/policy-resolution';

const tenantId = 'de305d54-75b4-431b-adb2-eb6b9e546014';
const employeeId = 'c56a4180-65aa-42ec-a945-5fd21dec0538';
const departmentId = '8d11d74a-e6b1-4a4c-9104-59538a65f28d';
const locationId = '81d4fae4-6c11-4bb5-9170-eea7fe9d9dd0';
const workDate = new Date('2026-08-12');

function policyVersion(overrides: Partial<Record<string, unknown>>) {
  return {
    id: 'version-id',
    tenantId,
    status: 'PUBLISHED',
    effectiveFrom: new Date('2026-08-01'),
    rules: { lateArrival: { graceMinutes: 10 } },
    ...overrides,
  };
}

function makeClient(options: {
  employee: Record<string, unknown> | null;
  versions: ReturnType<typeof policyVersion>[];
}) {
  const findFirst = jest.fn().mockResolvedValue(options.employee);
  const findMany = jest.fn().mockResolvedValue(options.versions);
  const client = {
    employee: { findFirst },
    policyVersion: { findMany },
  } as unknown as Prisma.TransactionClient;
  return { client, findFirst, findMany };
}

describe('resolveEffectivePolicy', () => {
  it('throws when the employee cannot be found', async () => {
    const { client } = makeClient({ employee: null, versions: [] });
    await expect(
      resolveEffectivePolicy(client, tenantId, employeeId, workDate),
    ).rejects.toBeInstanceOf(PolicyResolutionError);
  });

  it('throws a data-integrity error when even the tenant scope has no match', async () => {
    const { client } = makeClient({
      employee: { id: employeeId, departmentId: null, locationId: null, groupMemberships: [] },
      versions: [],
    });
    await expect(
      resolveEffectivePolicy(client, tenantId, employeeId, workDate),
    ).rejects.toThrow('data integrity violation');
  });

  it('falls back to the TENANT scope when nothing more specific matches', async () => {
    const { client } = makeClient({
      employee: { id: employeeId, departmentId: null, locationId: null, groupMemberships: [] },
      versions: [policyVersion({ scopeType: 'TENANT', scopeId: tenantId })],
    });
    const result = await resolveEffectivePolicy(client, tenantId, employeeId, workDate);
    expect(result.scopeType).toBe('TENANT');
    expect(result.scopeId).toBe(tenantId);
  });

  it('prefers EMPLOYEE over DEPARTMENT, LOCATION, and TENANT', async () => {
    const { client } = makeClient({
      employee: {
        id: employeeId,
        departmentId,
        locationId,
        groupMemberships: [],
      },
      versions: [
        policyVersion({ scopeType: 'TENANT', scopeId: tenantId, id: 'tenant-version' }),
        policyVersion({ scopeType: 'LOCATION', scopeId: locationId, id: 'location-version' }),
        policyVersion({ scopeType: 'DEPARTMENT', scopeId: departmentId, id: 'department-version' }),
        policyVersion({ scopeType: 'EMPLOYEE', scopeId: employeeId, id: 'employee-version' }),
      ],
    });
    const result = await resolveEffectivePolicy(client, tenantId, employeeId, workDate);
    expect(result.scopeType).toBe('EMPLOYEE');
    expect(result.policyVersion.id).toBe('employee-version');
  });

  it('prefers DEPARTMENT over LOCATION when no EMPLOYEE/EMPLOYEE_GROUP match', async () => {
    const { client } = makeClient({
      employee: { id: employeeId, departmentId, locationId, groupMemberships: [] },
      versions: [
        policyVersion({ scopeType: 'TENANT', scopeId: tenantId, id: 'tenant-version' }),
        policyVersion({ scopeType: 'LOCATION', scopeId: locationId, id: 'location-version' }),
        policyVersion({ scopeType: 'DEPARTMENT', scopeId: departmentId, id: 'department-version' }),
      ],
    });
    const result = await resolveEffectivePolicy(client, tenantId, employeeId, workDate);
    expect(result.scopeType).toBe('DEPARTMENT');
    expect(result.policyVersion.id).toBe('department-version');
  });

  it('breaks a group tie by higher priority', async () => {
    const { client } = makeClient({
      employee: {
        id: employeeId,
        departmentId: null,
        locationId: null,
        groupMemberships: [
          { group: { id: 'group-low', priority: 1 } },
          { group: { id: 'group-high', priority: 10 } },
        ],
      },
      versions: [
        policyVersion({ scopeType: 'TENANT', scopeId: tenantId, id: 'tenant-version' }),
        policyVersion({ scopeType: 'EMPLOYEE_GROUP', scopeId: 'group-low', id: 'low-version' }),
        policyVersion({ scopeType: 'EMPLOYEE_GROUP', scopeId: 'group-high', id: 'high-version' }),
      ],
    });
    const result = await resolveEffectivePolicy(client, tenantId, employeeId, workDate);
    expect(result.policyVersion.id).toBe('high-version');
  });

  it('breaks an equal-priority group tie by ascending group id', async () => {
    const { client } = makeClient({
      employee: {
        id: employeeId,
        departmentId: null,
        locationId: null,
        groupMemberships: [
          { group: { id: 'group-b', priority: 5 } },
          { group: { id: 'group-a', priority: 5 } },
        ],
      },
      versions: [
        policyVersion({ scopeType: 'TENANT', scopeId: tenantId, id: 'tenant-version' }),
        policyVersion({ scopeType: 'EMPLOYEE_GROUP', scopeId: 'group-a', id: 'a-version' }),
        policyVersion({ scopeType: 'EMPLOYEE_GROUP', scopeId: 'group-b', id: 'b-version' }),
      ],
    });
    const result = await resolveEffectivePolicy(client, tenantId, employeeId, workDate);
    expect(result.policyVersion.id).toBe('a-version');
  });

  it('picks the latest effectiveFrom when a scope has multiple published versions', async () => {
    const { client } = makeClient({
      employee: { id: employeeId, departmentId: null, locationId: null, groupMemberships: [] },
      versions: [
        policyVersion({
          scopeType: 'TENANT',
          scopeId: tenantId,
          id: 'newer',
          effectiveFrom: new Date('2026-08-10'),
        }),
        policyVersion({
          scopeType: 'TENANT',
          scopeId: tenantId,
          id: 'older',
          effectiveFrom: new Date('2026-01-01'),
        }),
      ],
    });
    const result = await resolveEffectivePolicy(client, tenantId, employeeId, workDate);
    expect(result.policyVersion.id).toBe('newer');
  });

  it('queries only PUBLISHED versions effective on or before the target date', async () => {
    const { client, findMany } = makeClient({
      employee: { id: employeeId, departmentId: null, locationId: null, groupMemberships: [] },
      versions: [policyVersion({ scopeType: 'TENANT', scopeId: tenantId })],
    });
    await resolveEffectivePolicy(client, tenantId, employeeId, workDate);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          status: 'PUBLISHED',
          effectiveFrom: { lte: workDate },
        }),
      }),
    );
  });

  it('returns a scopeChainEvaluated trace annotating which candidates matched', async () => {
    const { client } = makeClient({
      employee: { id: employeeId, departmentId, locationId: null, groupMemberships: [] },
      versions: [policyVersion({ scopeType: 'TENANT', scopeId: tenantId })],
    });
    const result = await resolveEffectivePolicy(client, tenantId, employeeId, workDate);
    expect(result.scopeChainEvaluated).toEqual([
      { scopeType: 'EMPLOYEE', scopeId: employeeId, matched: false },
      { scopeType: 'DEPARTMENT', scopeId: departmentId, matched: false },
      { scopeType: 'TENANT', scopeId: tenantId, matched: true },
    ]);
  });
});
