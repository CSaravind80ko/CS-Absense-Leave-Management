import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { PayrollFilesService } from './payroll-files.service';

@Module({
  controllers: [PayrollController],
  providers: [PayrollService, PayrollFilesService],
})
export class PayrollModule {}
