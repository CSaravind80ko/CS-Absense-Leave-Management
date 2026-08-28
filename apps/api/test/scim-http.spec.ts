import { HttpStatus } from '@nestjs/common';
import { ApplicationRole } from '@prisma/client';
import { of } from 'rxjs';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { ScimAdminController } from '../src/scim/scim-admin.controller';
import { ScimExceptionFilter } from '../src/scim/scim-exception.filter';
import {
  SCIM_ERROR_SCHEMA,
  SCIM_MEDIA_TYPE,
  ScimException,
} from '../src/scim/scim-protocol';
import { ScimResponseInterceptor } from '../src/scim/scim-response.interceptor';

describe('SCIM HTTP contract', () => {
  it('uses application/scim+json for successful responses', () => {
    const type = jest.fn();
    const interceptor = new ScimResponseInterceptor();
    const response = interceptor.intercept(
      {
        switchToHttp: () => ({ getResponse: () => ({ type }) }),
      } as never,
      { handle: () => of({ ok: true }) },
    );
    expect(type).toHaveBeenCalledWith(SCIM_MEDIA_TYPE);
    expect(response).toBeDefined();
  });

  it('returns RFC 7644 error shapes with correlation IDs', () => {
    const json = jest.fn();
    const setHeader = jest.fn().mockReturnThis();
    const type = jest.fn().mockReturnThis();
    const status = jest.fn().mockReturnValue({ type, setHeader, json });
    const filter = new ScimExceptionFilter();
    filter.catch(
      new ScimException(
        HttpStatus.BAD_REQUEST,
        'Unsupported filter',
        'invalidFilter',
      ),
      {
        switchToHttp: () => ({
          getResponse: () => ({ status }),
          getRequest: () => ({ correlationId: 'request-123' }),
        }),
      } as never,
    );
    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(type).toHaveBeenCalledWith(SCIM_MEDIA_TYPE);
    expect(setHeader).toHaveBeenCalledWith(
      'X-Correlation-Id',
      'request-123',
    );
    expect(json).toHaveBeenCalledWith({
      schemas: [SCIM_ERROR_SCHEMA],
      detail: 'Unsupported filter',
      status: '400',
      scimType: 'invalidFilter',
    });
  });

  it('restricts every SCIM administration endpoint to tenant admins', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ScimAdminController)).toEqual([
      ApplicationRole.TENANT_ADMIN,
    ]);
  });
});
