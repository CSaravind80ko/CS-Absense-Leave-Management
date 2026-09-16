import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthenticatedRequest } from '../types/authenticated-request';

/**
 * NestJS already returns a safe generic 500 for unhandled errors and passes HttpExceptions
 * through unchanged, so this filter isn't closing a leak - it exists to attach request context
 * (tenant, actor, path) that the default logger omits, since a bare stack trace is hard to
 * triage in a multi-tenant system once something goes wrong in production.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('UnhandledException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Partial<AuthenticatedRequest>>();
    const context = JSON.stringify({
      method: request?.method,
      path: request?.originalUrl,
      tenantId: request?.tenantId,
      subject: request?.auth?.subject,
    });

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        this.logger.error(exception.message, exception.stack, context);
      }
      response.status(status).json(exception.getResponse());
      return;
    }

    this.logger.error(
      exception instanceof Error ? exception.message : 'Unknown error',
      exception instanceof Error ? exception.stack : undefined,
      context,
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  }
}
