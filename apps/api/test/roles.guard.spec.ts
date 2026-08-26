import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApplicationRole } from '@prisma/client';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { AuthenticatedRequest } from '../src/common/types/authenticated-request';

function contextFor(role?: ApplicationRole): ExecutionContext {
  const request: Partial<AuthenticatedRequest> = { tenantRole: role };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => undefined,
      getNext: () => undefined,
    }),
    getHandler: () => contextFor,
    getClass: () => RolesGuard,
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

describe('RolesGuard', () => {
  it('allows a role declared for the operation', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([ApplicationRole.HR_ADMIN]),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(contextFor(ApplicationRole.HR_ADMIN))).toBe(true);
  });

  it('rejects a role not declared for the operation', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([ApplicationRole.PAYROLL_ADMIN]),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(() => guard.canActivate(contextFor(ApplicationRole.EMPLOYEE))).toThrow(
      ForbiddenException,
    );
  });
});
