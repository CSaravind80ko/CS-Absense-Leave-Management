import { Module } from '@nestjs/common';
import { AuditEventsController } from './audit-events.controller';
import { AuditEventsService } from './audit-events.service';

@Module({
  controllers: [AuditEventsController],
  providers: [AuditEventsService],
})
export class AuditEventsModule {}
