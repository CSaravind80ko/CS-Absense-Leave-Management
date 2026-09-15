import { ArgumentsHost, BadRequestException, HttpStatus } from '@nestjs/common';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';

function hostFor(request: Record<string, unknown>) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => request,
      getNext: () => undefined,
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('GlobalExceptionFilter', () => {
  it('passes an HttpException through with its own status and body', () => {
    const filter = new GlobalExceptionFilter();
    const { host, status, json } = hostFor({ method: 'GET', originalUrl: '/x' });

    filter.catch(new BadRequestException('bad input'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'bad input' }),
    );
  });

  it('returns a generic safe message for an unhandled error, never the raw error message', () => {
    const filter = new GlobalExceptionFilter();
    const { host, status, json } = hostFor({ method: 'GET', originalUrl: '/x' });

    filter.catch(new Error('leaked internal detail: db password xyz'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  });

  it('does not throw when request context fields are missing', () => {
    const filter = new GlobalExceptionFilter();
    const { host, status } = hostFor({});

    expect(() => filter.catch(new Error('oops'), host)).not.toThrow();
    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
  });
});
