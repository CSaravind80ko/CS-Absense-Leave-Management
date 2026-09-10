import { Module } from '@nestjs/common';
import { RecomputeJobsController } from './recompute-jobs.controller';
import { RecomputeJobsService } from './recompute-jobs.service';

@Module({
  controllers: [RecomputeJobsController],
  providers: [RecomputeJobsService],
})
export class RecomputeJobsModule {}
