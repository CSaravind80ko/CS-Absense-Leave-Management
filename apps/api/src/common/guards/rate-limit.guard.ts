import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SKIP_RATE_LIMIT_KEY } from '../decorators/skip-rate-limit.decorator';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * A minimal in-memory fixed-window limiter, not a distributed one: it tracks requests per
 * instance, keyed by client IP, and resets every windowMs. This is a first line of defense
 * against a single client flooding the API, not an exact global limit - once the service runs
 * on more than one instance, each instance enforces its own window independently. A shared
 * store (Redis) would be needed for a precise cross-instance limit; that's a bigger step than
 * this hardening pass takes on. req.ip is only accurate when Express's "trust proxy" setting
 * is configured for the deployment's actual proxy hop count - see main.ts.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();
  private readonly windowMs = 60_000;
  private readonly limit = Number(process.env.API_RATE_LIMIT_PER_MINUTE ?? 300);

  constructor(private readonly reflector: Reflector) {
    setInterval(() => this.sweep(), this.windowMs).unref();
  }

  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const request = context.switchToHttp().getRequest<{ ip?: string }>();
    const key = request.ip ?? 'unknown';
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    bucket.count += 1;
    if (bucket.count > this.limit) {
      throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
