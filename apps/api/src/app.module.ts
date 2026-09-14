import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApprovalsModule } from './approvals/approvals.module';
import { AttendanceModule } from './attendance/attendance.module';
import { AuditEventsModule } from './audit-events/audit-events.module';
import { IdentityDiscoveryController } from './auth/identity-discovery.controller';
import { IdentityDiscoveryService } from './auth/identity-discovery.service';
import { IdentityMembershipService } from './auth/identity-membership.service';
import { IdentityTokenVerifier } from './auth/identity-token-verifier.service';
import { IdentityAuthGuard } from './common/guards/identity-auth.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { EmployeeGroupsModule } from './employee-groups/employee-groups.module';
import { EmployeesModule } from './employees/employees.module';
import { ExceptionsModule } from './exceptions/exceptions.module';
import { HealthController } from './health/health.controller';
import { HolidaysModule } from './holidays/holidays.module';
import { LeaveBalancesModule } from './leave-balances/leave-balances.module';
import { LeaveRequestsModule } from './leave-requests/leave-requests.module';
import { LeaveTypesModule } from './leave-types/leave-types.module';
import { OrgModule } from './org/org.module';
import { PayrollModule } from './payroll/payroll.module';
import { PoliciesModule } from './policies/policies.module';
import { PrismaModule } from './prisma/prisma.module';
import { RecomputeJobsModule } from './recompute-jobs/recompute-jobs.module';
import { ShiftsModule } from './shifts/shifts.module';
import { MeModule } from './me/me.module';
import { TenantUsersModule } from './tenant-users/tenant-users.module';
import { SamlConnectionsModule } from './saml-connections/saml-connections.module';
import { ScimModule } from './scim/scim.module';

@Module({
  imports: [
    PrismaModule,
    EmployeesModule,
    AttendanceModule,
    AuditEventsModule,
    ExceptionsModule,
    ApprovalsModule,
    PayrollModule,
    PoliciesModule,
    EmployeeGroupsModule,
    OrgModule,
    HolidaysModule,
    RecomputeJobsModule,
    ShiftsModule,
    LeaveTypesModule,
    LeaveBalancesModule,
    LeaveRequestsModule,
    MeModule,
    TenantUsersModule,
    SamlConnectionsModule,
    ScimModule,
  ],
  controllers: [HealthController, IdentityDiscoveryController],
  providers: [
    IdentityDiscoveryService,
    IdentityMembershipService,
    IdentityTokenVerifier,
    { provide: APP_GUARD, useClass: IdentityAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [IdentityMembershipService],
})
export class AppModule {}
