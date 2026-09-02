import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import { SCIM_MEDIA_TYPE } from './scim-protocol';

@Injectable()
export class ScimResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    context.switchToHttp().getResponse<Response>().type(SCIM_MEDIA_TYPE);
    return next.handle();
  }
}
