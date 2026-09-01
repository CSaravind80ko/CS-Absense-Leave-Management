import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApplicationRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { Subject } from '../common/decorators/subject.decorator';
import { TenantId } from '../common/decorators/tenant.decorator';
import { PoliciesService } from './policies.service';
import { CreatePolicyVersionDto } from './dto/create-policy-version.dto';
import { UpdatePolicyVersionDto } from './dto/update-policy-version.dto';
import { PublishPolicyVersionDto } from './dto/publish-policy-version.dto';
import { PolicyQueryDto } from './dto/policy-query.dto';
import { ResolvePolicyDto } from './dto/resolve-policy.dto';

@Controller('policies')
@Roles(
  ApplicationRole.TENANT_ADMIN,
  ApplicationRole.HR_ADMIN,
  ApplicationRole.PAYROLL_ADMIN,
  ApplicationRole.MANAGER,
  ApplicationRole.AUDITOR,
)
export class PoliciesController {
  constructor(private readonly policies: PoliciesService) {}

  @Get()
  list(@TenantId() tenantId: string, @Query() query: PolicyQueryDto) {
    return this.policies.list(tenantId, query);
  }

  @Get('effective')
  listEffective(@TenantId() tenantId: string) {
    return this.policies.listEffective(tenantId);
  }

  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.policies.get(tenantId, id);
  }

  @Post()
  @Roles(ApplicationRole.TENANT_ADMIN, ApplicationRole.HR_ADMIN)
  createDraft(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Body() dto: CreatePolicyVersionDto,
  ) {
    return this.policies.createDraft(tenantId, subject, dto);
  }

  @Put(':id')
  @Roles(ApplicationRole.TENANT_ADMIN, ApplicationRole.HR_ADMIN)
  updateDraft(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePolicyVersionDto,
  ) {
    return this.policies.updateDraft(tenantId, id, subject, dto);
  }

  @Delete(':id')
  @Roles(ApplicationRole.TENANT_ADMIN, ApplicationRole.HR_ADMIN)
  deleteDraft(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.policies.deleteDraft(tenantId, id, subject);
  }

  @Post(':id/publish')
  @Roles(ApplicationRole.TENANT_ADMIN, ApplicationRole.HR_ADMIN)
  publish(
    @TenantId() tenantId: string,
    @Subject() subject: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishPolicyVersionDto,
  ) {
    return this.policies.publish(tenantId, id, subject, dto);
  }

  @Post('resolve')
  resolve(@TenantId() tenantId: string, @Body() dto: ResolvePolicyDto) {
    return this.policies.resolve(tenantId, dto);
  }
}
