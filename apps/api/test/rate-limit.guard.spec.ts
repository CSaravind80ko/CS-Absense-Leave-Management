import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitGuard } from '../src/common/guards/rate-limit.guard';

function contextFor(ip: string): ExecutionContext {
  const request = { ip };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => undefined,
      getNext: () => undefined,
    }),
    getHandler: () => contextFor,
    getClass: () => RateLimitGuard,
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

function guardWith(skip: boolean, limit: number) {
  const originalEnv = process.env.API_RATE_LIMIT_PER_MINUTE;
  process.env.API_RATE_LIMIT_PER_MINUTE = String(limit);
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(skip),
  } as unknown as Reflector;
  const guard = new RateLimitGuard(reflector);
  process.env.API_RATE_LIMIT_PER_MINUTE = originalEnv;
  return guard;
}

describe('RateLimitGuard', () => {
  it('allows requests under the configured limit', () => {
    const guard = guardWith(false, 3);

    expect(guard.canActivate(contextFor('1.2.3.4'))).toBe(true);
    expect(guard.canActivate(contextFor('1.2.3.4'))).toBe(true);
    expect(guard.canActivate(contextFor('1.2.3.4'))).toBe(true);
  });

  it('rejects once a single client exceeds the limit within the window', () => {
    const guard = guardWith(false, 2);

    expect(guard.canActivate(contextFor('5.6.7.8'))).toBe(true);
    expect(guard.canActivate(contextFor('5.6.7.8'))).toBe(true);
    expect(() => guard.canActivate(contextFor('5.6.7.8'))).toThrow(HttpException);
  });

  it('tracks separate clients independently', () => {
    const guard = guardWith(false, 1);

    expect(guard.canActivate(contextFor('9.9.9.9'))).toBe(true);
    expect(guard.canActivate(contextFor('8.8.8.8'))).toBe(true);
  });

  it('bypasses the limit entirely when the handler opts out', () => {
    const guard = guardWith(true, 1);

    expect(guard.canActivate(contextFor('1.1.1.1'))).toBe(true);
    expect(guard.canActivate(contextFor('1.1.1.1'))).toBe(true);
    expect(guard.canActivate(contextFor('1.1.1.1'))).toBe(true);
  });
});
