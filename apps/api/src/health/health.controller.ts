import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

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
