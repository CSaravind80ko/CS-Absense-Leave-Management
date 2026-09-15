import { Module } from '@nestjs/common';
import { AttendanceSourceConnectionsController } from './attendance-source-connections.controller';
import { AttendanceSourceConnectionsService } from './attendance-source-connections.service';

@Module({
  controllers: [AttendanceSourceConnectionsController],
  providers: [AttendanceSourceConnectionsService],
})
export class AttendanceSourceConnectionsModule {}
