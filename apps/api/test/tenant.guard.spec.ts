import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantGuard } from '../src/common/guards/tenant.guard';
import { AuthenticatedRequest } from '../src/common/types/authenticated-request';
import { IdentityMembershipService } from '../src/auth/identity-membership.service';

const TENANT_ID = 'de305d54-75b4-431b-adb2-eb6b9e546014';

function contextFor(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => undefined,
      getNext: () => undefined,
    }),
    getHandler: () => contextFor,
    getClass: () => TenantGuard,
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToRpc: () => {
      throw new Error('not used');
    },
    switchToWs: () => {
      throw new Error('not used');
    },
    getType: () => 'http',
  } as ExecutionContext;
}

describe('TenantGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(false),
  } as unknown as Reflector;
  const find = jest.fn();
  const identities = { find } as unknown as IdentityMembershipService;
  const guard = new TenantGuard(reflector, identities);

  beforeEach(() => find.mockReset());

  it('allows authenticated routes that explicitly skip tenant selection', async () => {
    const skipReflector = {
      getAllAndOverride: jest.fn((key: string) => key === 'skipTenant'),
    } as unknown as Reflector;
    const skipGuard = new TenantGuard(skipReflector, identities);

    await expect(skipGuard.canActivate(contextFor({ headers: {} }))).resolves.toBe(
      true,
    );
    expect(find).not.toHaveBeenCalled();
  });

  it('rejects a missing tenant header', async () => {
    const request = {
      headers: {},
      auth: { connectionId: 'connection-1', subject: 'user-1', claims: {} },
    };
    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(find).not.toHaveBeenCalled();
  });

  it('rejects a subject without an active membership', async () => {
    find.mockResolvedValue(null);
    const request = {
      headers: { 'x-tenant-id': TENANT_ID },
      auth: { connectionId: 'connection-1', subject: 'user-1', claims: {} },
    };
    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('sets tenant context for an active membership', async () => {
    find.mockResolvedValue({
      active: true,
      role: 'HR_ADMIN',
      tenant: { status: 'ACTIVE' },
    });
    const request: Partial<AuthenticatedRequest> = {
      headers: { 'x-tenant-id': TENANT_ID },
      auth: { connectionId: 'connection-1', subject: 'user-1', claims: {} },
    };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.tenantId).toBe(TENANT_ID);
    expect(request.tenantRole).toBe('HR_ADMIN');
    expect(find).toHaveBeenCalledWith(
      'connection-1',
      'user-1',
      TENANT_ID,
    );
  });
});
