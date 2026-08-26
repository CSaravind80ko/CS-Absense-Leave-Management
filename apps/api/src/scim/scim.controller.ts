import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { ScimAuthGuard } from './scim-auth.guard';
import { ScimExceptionFilter } from './scim-exception.filter';
import { ScimResponseInterceptor } from './scim-response.interceptor';
import type { ScimRequest } from './scim-protocol';
import { ScimService } from './scim.service';

type AuthenticatedScimRequest = Request & ScimRequest;

@Controller('scim/v2/:tenantId/:samlConnectionId')
@Public()
@UseGuards(ScimAuthGuard)
@UseFilters(ScimExceptionFilter)
@UseInterceptors(ScimResponseInterceptor)
export class ScimController {
  constructor(private readonly scim: ScimService) {}

  @Get('ServiceProviderConfig')
  serviceProviderConfig(@Req() request: AuthenticatedScimRequest) {
    return this.withCorrelation(request, this.scim.serviceProviderConfig());
  }

  @Get('ResourceTypes')
  resourceTypes(@Req() request: AuthenticatedScimRequest) {
    return this.withCorrelation(request, this.scim.resourceTypes());
  }

  @Get('ResourceTypes/:id')
  resourceType(
    @Req() request: AuthenticatedScimRequest,
    @Param('id') id: string,
  ) {
    return this.withCorrelation(request, this.scim.resourceType(id));
  }

  @Get('Schemas')
  schemas(@Req() request: AuthenticatedScimRequest) {
    return this.withCorrelation(request, this.scim.schemas());
  }

  @Get('Schemas/:id')
  schema(
    @Req() request: AuthenticatedScimRequest,
    @Param('id') id: string,
  ) {
    return this.withCorrelation(request, this.scim.schema(id));
  }

  @Get('Users')
  async listUsers(
    @Req() request: AuthenticatedScimRequest,
    @Query('filter') filter?: string,
    @Query('startIndex') startIndex?: string,
    @Query('count') count?: string,
  ) {
    return this.withCorrelation(
      request,
      await this.scim.listUsers(request.scim!, baseUrl(request), {
        filter,
        startIndex,
        count,
      }),
    );
  }

  @Get('Users/:id')
  async getUser(
    @Req() request: AuthenticatedScimRequest,
    @Param('id') id: string,
  ) {
    return this.withCorrelation(
      request,
      await this.scim.getUser(request.scim!, id, baseUrl(request)),
    );
  }

  @Post('Users')
  @HttpCode(HttpStatus.CREATED)
  async createUser(
    @Req() request: AuthenticatedScimRequest,
    @Res({ passthrough: true }) response: Response,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const result = await this.scim.idempotent(
      request.scim!,
      idempotencyKey,
      'POST',
      '/Users',
      body,
      HttpStatus.CREATED,
      () => this.scim.createUser(request.scim!, body, baseUrl(request)),
    );
    response.status(result.status);
    const resource = this.withCorrelation(request, result.body);
    response.setHeader('Location', resource.meta.location);
    response.setHeader('ETag', resource.meta.version);
    return resource;
  }

  @Put('Users/:id')
  async replaceUser(
    @Req() request: AuthenticatedScimRequest,
    @Res({ passthrough: true }) response: Response,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const result = await this.scim.idempotent(
      request.scim!,
      idempotencyKey,
      'PUT',
      `/Users/${id}`,
      body,
      HttpStatus.OK,
      () => this.scim.replaceUser(request.scim!, id, body, baseUrl(request)),
    );
    response.status(result.status);
    const resource = this.withCorrelation(request, result.body);
    response.setHeader('ETag', resource.meta.version);
    return resource;
  }

  @Patch('Users/:id')
  async patchUser(
    @Req() request: AuthenticatedScimRequest,
    @Res({ passthrough: true }) response: Response,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const result = await this.scim.idempotent(
      request.scim!,
      idempotencyKey,
      'PATCH',
      `/Users/${id}`,
      body,
      HttpStatus.OK,
      () => this.scim.patchUser(request.scim!, id, body, baseUrl(request)),
    );
    response.status(result.status);
    const resource = this.withCorrelation(request, result.body);
    response.setHeader('ETag', resource.meta.version);
    return resource;
  }

  @Delete('Users/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteUser(
    @Req() request: AuthenticatedScimRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.scim.deleteUser(request.scim!, id);
    response.setHeader('X-Correlation-Id', request.correlationId!);
  }

  @Get('Groups')
  async listGroups(
    @Req() request: AuthenticatedScimRequest,
    @Query('filter') filter?: string,
    @Query('startIndex') startIndex?: string,
    @Query('count') count?: string,
  ) {
    return this.withCorrelation(
      request,
      await this.scim.listGroups(request.scim!, baseUrl(request), {
        filter,
        startIndex,
        count,
      }),
    );
  }

  @Get('Groups/:id')
  async getGroup(
    @Req() request: AuthenticatedScimRequest,
    @Param('id') id: string,
  ) {
    return this.withCorrelation(
      request,
      await this.scim.getGroup(request.scim!, id, baseUrl(request)),
    );
  }

  @Post('Groups')
  @HttpCode(HttpStatus.CREATED)
  async createGroup(
    @Req() request: AuthenticatedScimRequest,
    @Res({ passthrough: true }) response: Response,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const result = await this.scim.idempotent(
      request.scim!,
      idempotencyKey,
      'POST',
      '/Groups',
      body,
      HttpStatus.CREATED,
      () => this.scim.createGroup(request.scim!, body, baseUrl(request)),
    );
    response.status(result.status);
    const resource = this.withCorrelation(request, result.body);
    response.setHeader('Location', resource.meta.location);
    response.setHeader('ETag', resource.meta.version);
    return resource;
  }

  @Put('Groups/:id')
  async replaceGroup(
    @Req() request: AuthenticatedScimRequest,
    @Res({ passthrough: true }) response: Response,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const result = await this.scim.idempotent(
      request.scim!,
      idempotencyKey,
      'PUT',
      `/Groups/${id}`,
      body,
      HttpStatus.OK,
      () => this.scim.replaceGroup(request.scim!, id, body, baseUrl(request)),
    );
    response.status(result.status);
    const resource = this.withCorrelation(request, result.body);
    response.setHeader('ETag', resource.meta.version);
    return resource;
  }

  @Patch('Groups/:id')
  async patchGroup(
    @Req() request: AuthenticatedScimRequest,
    @Res({ passthrough: true }) response: Response,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const result = await this.scim.idempotent(
      request.scim!,
      idempotencyKey,
      'PATCH',
      `/Groups/${id}`,
      body,
      HttpStatus.OK,
      () => this.scim.patchGroup(request.scim!, id, body, baseUrl(request)),
    );
    response.status(result.status);
    const resource = this.withCorrelation(request, result.body);
    response.setHeader('ETag', resource.meta.version);
    return resource;
  }

  @Delete('Groups/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteGroup(
    @Req() request: AuthenticatedScimRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.scim.deleteGroup(request.scim!, id);
    response.setHeader('X-Correlation-Id', request.correlationId!);
  }

  private withCorrelation<T extends object>(
    request: AuthenticatedScimRequest,
    value: T,
  ): T {
    request.res?.setHeader('X-Correlation-Id', request.correlationId!);
    return value;
  }
}

function baseUrl(request: AuthenticatedScimRequest) {
  const configured = process.env.SCIM_PUBLIC_BASE_URL?.replace(/\/$/, '');
  if (configured) {
    return `${configured}/${request.params.tenantId}/${request.params.samlConnectionId}`;
  }
  const host = request.get('host');
  if (!host || !/^[A-Za-z0-9.:[\]-]+$/.test(host)) {
    throw new Error('SCIM_PUBLIC_BASE_URL is not configured');
  }
  return `${request.protocol}://${host}/api/v1/scim/v2/${request.params.tenantId}/${request.params.samlConnectionId}`;
}
