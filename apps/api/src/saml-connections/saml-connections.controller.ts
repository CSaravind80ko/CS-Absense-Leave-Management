import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApplicationRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { Subject } from '../common/decorators/subject.decorator';
import { TenantId } from '../common/decorators/tenant.decorator';
import { CreateSamlConnectionDto } from './dto/create-saml-connection.dto';
import { UpdateSamlMetadataDto } from './dto/update-saml-metadata.dto';
import { SamlConnectionsService } from './saml-connections.service';

@Controller('saml-connections')
@Roles(ApplicationRole.TENANT_ADMIN)
export class SamlConnectionsController {
  constructor(private readonly connections: SamlConnectionsService) {}

  @Get()
  list(@TenantId() tenantId: string) {
    return this.connections.list(tenantId);
  }

  @Get('identity-connections')
  identityConnections(@TenantId() tenantId: string) {
    return this.connections.identityConnections(tenantId);
  }

  @Get(':id')
  status(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.connections.status(tenantId, id);
  }

  @Post()
  createDraft(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Body() input: CreateSamlConnectionDto,
  ) {
    return this.connections.createDraft(tenantId, subject, input);
  }

  @Put(':id/metadata')
  updateMetadata(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Subject() subject: string,
    @Body() input: UpdateSamlMetadataDto,
  ) {
    return this.connections.updateMetadata(tenantId, id, subject, input);
  }

  @Post(':id/provision')
  provision(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Subject() subject: string,
  ) {
    return this.connections.provision(tenantId, id, subject);
  }

  @Post(':id/test')
  test(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Subject() subject: string,
  ) {
    return this.connections.test(tenantId, id, subject);
  }

  @Post(':id/activate')
  activate(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Subject() subject: string,
  ) {
    return this.connections.activate(tenantId, id, subject);
  }

  @Post(':id/disable')
  disable(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Subject() subject: string,
  ) {
    return this.connections.disable(tenantId, id, subject);
  }
}
