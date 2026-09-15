import { Controller, Get } from '@nestjs/common';
import { SkipRateLimit } from '../common/decorators/skip-rate-limit.decorator';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

// Exempt from rate limiting: ECS/ALB hit this on a tight interval, and a throttled health
// check would take the whole service down rather than protect it.
@SkipRateLimit()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async health(): Promise<{ status: 'ok'; database: 'up' }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', database: 'up' };
  }
}
