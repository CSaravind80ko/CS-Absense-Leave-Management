import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApprovalsModule } from './approvals/approvals.module';
import { AttendanceModule } from './attendance/attendance.module';
import { CognitoJwtService } from './auth/cognito-jwt.service';
import { CognitoAuthGuard } from './common/guards/cognito-auth.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { EmployeesModule } from './employees/employees.module';
import { ExceptionsModule } from './exceptions/exceptions.module';
import { HealthController } from './health/health.controller';
import { PayrollModule } from './payroll/payroll.module';
import { PrismaModule } from './prisma/prisma.module';
import { MeModule } from './me/me.module';

@Module({
  imports: [
    PrismaModule,
    EmployeesModule,
    AttendanceModule,
    ExceptionsModule,
    ApprovalsModule,
    PayrollModule,
    MeModule,
  ],
  controllers: [HealthController],
  providers: [
    CognitoJwtService,
    { provide: APP_GUARD, useClass: CognitoAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
