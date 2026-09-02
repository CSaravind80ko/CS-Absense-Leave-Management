import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApplicationRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { Subject } from '../common/decorators/subject.decorator';
import { TenantId } from '../common/decorators/tenant.decorator';
import { ScimAdminService } from './scim-admin.service';

@Controller('scim-admin')
@Roles(ApplicationRole.TENANT_ADMIN)
export class ScimAdminController {
  constructor(private readonly admin: ScimAdminService) {}

  @Get()
  list(@TenantId() tenantId: string) {
    return this.admin.list(tenantId);
  }

  @Post(':samlConnectionId/enable')
  enable(
    @TenantId() tenantId: string,
    @Param('samlConnectionId') samlConnectionId: string,
    @Subject() actorSubject: string,
    @Body() body: unknown,
  ) {
    return this.admin.enable(tenantId, samlConnectionId, actorSubject, body);
  }

  @Post(':samlConnectionId/disable')
  @HttpCode(204)
  disable(
    @TenantId() tenantId: string,
    @Param('samlConnectionId') samlConnectionId: string,
    @Subject() actorSubject: string,
  ) {
    return this.admin.disable(tenantId, samlConnectionId, actorSubject);
  }

  @Post(':samlConnectionId/credentials')
  issueCredential(
    @TenantId() tenantId: string,
    @Param('samlConnectionId') samlConnectionId: string,
    @Subject() actorSubject: string,
    @Body() body: unknown,
  ) {
    return this.admin.issueCredential(
      tenantId,
      samlConnectionId,
      actorSubject,
      body,
    );
  }

  @Post(':samlConnectionId/credentials/rotate')
  rotateCredential(
    @TenantId() tenantId: string,
    @Param('samlConnectionId') samlConnectionId: string,
    @Subject() actorSubject: string,
    @Body() body: unknown,
  ) {
    return this.admin.rotateCredential(
      tenantId,
      samlConnectionId,
      actorSubject,
      body,
    );
  }

  @Delete(':samlConnectionId/credentials/:credentialId')
  @HttpCode(204)
  revokeCredential(
    @TenantId() tenantId: string,
    @Param('samlConnectionId') samlConnectionId: string,
    @Param('credentialId') credentialId: string,
    @Subject() actorSubject: string,
  ) {
    return this.admin.revokeCredential(
      tenantId,
      samlConnectionId,
      credentialId,
      actorSubject,
    );
  }

  @Patch(':samlConnectionId/settings')
  updateSettings(
    @TenantId() tenantId: string,
    @Param('samlConnectionId') samlConnectionId: string,
    @Subject() actorSubject: string,
    @Body() body: unknown,
  ) {
    return this.admin.updateSettings(
      tenantId,
      samlConnectionId,
      actorSubject,
      body,
    );
  }

  @Get(':samlConnectionId/groups')
  groups(
    @TenantId() tenantId: string,
    @Param('samlConnectionId') samlConnectionId: string,
  ) {
    return this.admin.groups(tenantId, samlConnectionId);
  }

  @Put(':samlConnectionId/groups/:groupId/role-mapping')
  mapGroupRole(
    @TenantId() tenantId: string,
    @Param('samlConnectionId') samlConnectionId: string,
    @Param('groupId') groupId: string,
    @Subject() actorSubject: string,
    @Body() body: unknown,
  ) {
    return this.admin.mapGroupRole(
      tenantId,
      samlConnectionId,
      groupId,
      actorSubject,
      body,
    );
  }

  @Delete(':samlConnectionId/groups/:groupId/role-mapping')
  @HttpCode(204)
  deleteGroupRoleMapping(
    @TenantId() tenantId: string,
    @Param('samlConnectionId') samlConnectionId: string,
    @Param('groupId') groupId: string,
    @Subject() actorSubject: string,
  ) {
    return this.admin.deleteGroupRoleMapping(
      tenantId,
      samlConnectionId,
      groupId,
      actorSubject,
    );
  }

  @Get(':samlConnectionId/events')
  events(
    @TenantId() tenantId: string,
    @Param('samlConnectionId') samlConnectionId: string,
  ) {
    return this.admin.events(tenantId, samlConnectionId);
  }
}
