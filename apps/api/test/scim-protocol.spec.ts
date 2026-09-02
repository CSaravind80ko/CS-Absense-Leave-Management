import { HttpStatus } from '@nestjs/common';
import {
  SCIM_PATCH_SCHEMA,
  ScimException,
  parseFilter,
  parsePagination,
  validateEmails,
} from '../src/scim/scim-protocol';
import { ScimService } from '../src/scim/scim.service';

describe('SCIM protocol helpers', () => {
  it('parses only allowlisted single equality filters', () => {
    expect(
      parseFilter('userName eq "Case.User@example.com"', new Set(['userName'])),
    ).toEqual({ attribute: 'userName', value: 'Case.User@example.com' });
    expect(() =>
      parseFilter('userName eq "a" and active eq true', new Set(['userName'])),
    ).toThrow(ScimException);
    expect(() =>
      parseFilter('emails.value eq "a@example.com"', new Set(['userName'])),
    ).toThrow(
      expect.objectContaining({
        status: HttpStatus.BAD_REQUEST,
        scimType: 'invalidFilter',
      }),
    );
  });

  it('enforces one-based pagination and the server page cap', () => {
    expect(parsePagination(undefined, undefined)).toEqual({
      startIndex: 1,
      count: 100,
      skip: 0,
    });
    expect(parsePagination('21', '50')).toEqual({
      startIndex: 21,
      count: 50,
      skip: 20,
    });
    expect(() => parsePagination('0', '10')).toThrow(ScimException);
    expect(() => parsePagination('1', '201')).toThrow(ScimException);
  });

  it('normalizes emails and rejects multiple primary values', () => {
    expect(
      validateEmails([
        { value: 'User@Example.com', type: 'work', primary: true },
      ]),
    ).toEqual([
      { value: 'user@example.com', type: 'work', primary: true },
    ]);
    expect(() =>
      validateEmails([
        { value: 'a@example.com', primary: true },
        { value: 'b@example.com', primary: true },
      ]),
    ).toThrow(ScimException);
  });

  it('advertises RFC 7644 patch, filter, ETag, user, and group support', () => {
    const service = new ScimService({} as never, () => ({ send: jest.fn() }));
    expect(service.serviceProviderConfig()).toMatchObject({
      patch: { supported: true },
      filter: { supported: true, maxResults: 200 },
      etag: { supported: true },
      bulk: { supported: false },
    });
    expect(service.resourceTypes().Resources.map((item) => item.id)).toEqual([
      'User',
      'Group',
    ]);
    expect(SCIM_PATCH_SCHEMA).toContain('PatchOp');
  });
});
