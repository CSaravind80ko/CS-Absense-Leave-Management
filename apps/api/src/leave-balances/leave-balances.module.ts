import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { LeaveBalancesController } from './leave-balances.controller';
import { LeaveBalancesService } from './leave-balances.service';

@Module({
  imports: [EmployeesModule],
  controllers: [LeaveBalancesController],
  providers: [LeaveBalancesService],
  exports: [LeaveBalancesService],
})
export class LeaveBalancesModule {}
