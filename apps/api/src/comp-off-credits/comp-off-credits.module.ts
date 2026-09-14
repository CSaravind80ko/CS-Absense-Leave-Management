import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { CompOffCreditsController } from './comp-off-credits.controller';
import { CompOffCreditsService } from './comp-off-credits.service';

@Module({
  imports: [EmployeesModule],
  controllers: [CompOffCreditsController],
  providers: [CompOffCreditsService],
})
export class CompOffCreditsModule {}
