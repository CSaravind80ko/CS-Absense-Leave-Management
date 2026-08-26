import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import {
  SCIM_ERROR_SCHEMA,
  SCIM_MEDIA_TYPE,
  ScimException,
  type ScimRequest,
} from './scim-protocol';

@Catch()
export class ScimExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<ScimRequest>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const detail =
      status === HttpStatus.INTERNAL_SERVER_ERROR
        ? 'The provisioning request could not be completed'
        : exception instanceof Error
          ? exception.message
          : 'The provisioning request is invalid';
    const correlationId = request.correlationId ?? randomUUID();
    response
      .status(status)
      .type(SCIM_MEDIA_TYPE)
      .setHeader('X-Correlation-Id', correlationId)
      .json({
        schemas: [SCIM_ERROR_SCHEMA],
        detail,
        status: String(status),
        ...(exception instanceof ScimException && exception.scimType
          ? { scimType: exception.scimType }
          : {}),
      });
  }
}
