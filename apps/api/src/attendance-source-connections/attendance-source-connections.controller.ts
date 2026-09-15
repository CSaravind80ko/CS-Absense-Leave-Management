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
import { AttendanceSourceConnectionsService } from './attendance-source-connections.service';
import { CreateConnectionDto } from './dto/create-connection.dto';
import { RecordSyncLogDto } from './dto/record-sync-log.dto';
import { UpdateConnectionDto } from './dto/update-connection.dto';
import { UpdateConnectionStatusDto } from './dto/update-connection-status.dto';

@Controller('integrations/connections')
@Roles(ApplicationRole.TENANT_ADMIN, ApplicationRole.HR_ADMIN, ApplicationRole.AUDITOR)
export class AttendanceSourceConnectionsController {
  constructor(private readonly connections: AttendanceSourceConnectionsService) {}

  @Get()
  list(@TenantId() tenantId: string) {
    return this.connections.list(tenantId);
  }

  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.connections.get(tenantId, id);
  }

  @Post()
  @Roles(ApplicationRole.TENANT_ADMIN, ApplicationRole.HR_ADMIN)
  create(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Body() dto: CreateConnectionDto,
  ) {
    return this.connections.create(tenantId, subject, dto);
  }

  @Patch(':id')
  @Roles(ApplicationRole.TENANT_ADMIN, ApplicationRole.HR_ADMIN)
  update(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConnectionDto,
  ) {
    return this.connections.update(tenantId, subject, id, dto);
  }

  @Patch(':id/status')
  @Roles(ApplicationRole.TENANT_ADMIN, ApplicationRole.HR_ADMIN)
  updateStatus(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConnectionStatusDto,
  ) {
    return this.connections.updateStatus(tenantId, subject, id, dto);
  }

  @Post(':id/sync-logs')
  @Roles(ApplicationRole.TENANT_ADMIN, ApplicationRole.HR_ADMIN)
  recordSyncLog(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordSyncLogDto,
  ) {
    return this.connections.recordSyncLog(tenantId, subject, id, dto);
  }
}
