import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { OnDutyRequestsController } from './on-duty-requests.controller';
import { OnDutyRequestsService } from './on-duty-requests.service';

@Module({
  imports: [EmployeesModule],
  controllers: [OnDutyRequestsController],
  providers: [OnDutyRequestsService],
})
export class OnDutyRequestsModule {}
