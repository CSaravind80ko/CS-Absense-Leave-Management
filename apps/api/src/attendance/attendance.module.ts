import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { ImportStorageService } from './import-storage.service';

@Module({
  controllers: [AttendanceController],
  providers: [AttendanceService, ImportStorageService],
})
export class AttendanceModule {}
