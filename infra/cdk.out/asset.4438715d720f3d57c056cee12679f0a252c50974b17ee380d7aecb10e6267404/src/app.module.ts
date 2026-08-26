import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApprovalsModule } from './approvals/approvals.module';
import { AttendanceModule } from './attendance/attendance.module';
import { CognitoJwtService } from './auth/cognito-jwt.service';
import { CognitoAuthGuard } from './common/guards/cognito-auth.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { EmployeesModule } from './employees/employees.module';
import { ExceptionsModule } from './exceptions/exceptions.module';
import { HealthController } from './health/health.controller';
import { PayrollModule } from './payroll/payroll.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    EmployeesModule,
    AttendanceModule,
    ExceptionsModule,
    ApprovalsModule,
    PayrollModule,
  ],
  controllers: [HealthController],
  providers: [
    CognitoJwtService,
    { provide: APP_GUARD, useClass: CognitoAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
  ],
})
export class AppModule {}
