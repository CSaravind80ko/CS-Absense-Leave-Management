import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { ImportStorageService } from './import-storage.service';

@Module({
  imports: [EmployeesModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, ImportStorageService],
})
export class AttendanceModule {}
