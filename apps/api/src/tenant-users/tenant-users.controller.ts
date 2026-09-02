import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApplicationRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { Subject } from '../common/decorators/subject.decorator';
import { TenantId } from '../common/decorators/tenant.decorator';
import { InviteTenantUserDto } from './dto/invite-tenant-user.dto';
import { UpdateTenantUserMfaDto } from './dto/update-tenant-user-mfa.dto';
import { UpdateTenantUserRoleDto } from './dto/update-tenant-user-role.dto';
import { TenantUsersService } from './tenant-users.service';

@Controller('tenant-users')
@Roles(ApplicationRole.TENANT_ADMIN)
export class TenantUsersController {
  constructor(private readonly users: TenantUsersService) {}

  @Get()
  list(@TenantId() tenantId: string) {
    return this.users.list(tenantId);
  }

  @Post('invitations')
  invite(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Body() input: InviteTenantUserDto,
  ) {
    return this.users.invite(tenantId, subject, input);
  }

  @Patch(':id/role')
  assignRole(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Subject() subject: string,
    @Body() input: UpdateTenantUserRoleDto,
  ) {
    return this.users.assignRole(tenantId, id, subject, input.role);
  }

  @Patch(':id/mfa-policy')
  setMfaPolicy(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Subject() subject: string,
    @Body() input: UpdateTenantUserMfaDto,
  ) {
    return this.users.setMfaPolicy(tenantId, id, subject, input.required);
  }

  @Post(':id/disable')
  disable(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Subject() subject: string,
  ) {
    return this.users.disable(tenantId, id, subject);
  }

  @Post(':id/enable')
  enable(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Subject() subject: string,
  ) {
    return this.users.enable(tenantId, id, subject);
  }

  @Post(':id/resend-invitation')
  resendInvitation(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Subject() subject: string,
  ) {
    return this.users.resendInvitation(tenantId, id, subject);
  }

  @Post(':id/reset-password')
  resetPassword(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Subject() subject: string,
  ) {
    return this.users.resetPassword(tenantId, id, subject);
  }
}
