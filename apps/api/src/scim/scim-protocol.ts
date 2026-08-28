import { HttpException, HttpStatus } from '@nestjs/common';

export const SCIM_MEDIA_TYPE = 'application/scim+json';
export const SCIM_USER_SCHEMA =
  'urn:ietf:params:scim:schemas:core:2.0:User';
export const SCIM_GROUP_SCHEMA =
  'urn:ietf:params:scim:schemas:core:2.0:Group';
export const SCIM_PATCH_SCHEMA =
  'urn:ietf:params:scim:api:messages:2.0:PatchOp';
export const SCIM_LIST_SCHEMA =
  'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const SCIM_ERROR_SCHEMA =
  'urn:ietf:params:scim:api:messages:2.0:Error';

export class ScimException extends HttpException {
  constructor(
    status: HttpStatus,
    message: string,
    readonly scimType?: string,
  ) {
    super(message, status);
  }
}

export interface ScimContext {
  tenantId: string;
  samlConnectionId: string;
  provisioningConnectionId: string;
  identityConnectionId: string;
  credentialId: string;
}

export interface ScimRequest {
  headers: Record<string, string | string[] | undefined>;
  params: Record<string, string>;
  method: string;
  originalUrl: string;
  ip?: string;
  scim?: ScimContext;
  correlationId?: string;
}

export interface ScimEmail {
  value: string;
  type?: string;
  primary?: boolean;
}

export interface ScimUserInput {
  schemas?: string[];
  externalId?: string | null;
  userName: string;
  name?: {
    formatted?: string | null;
    givenName?: string | null;
    familyName?: string | null;
  } | null;
  emails?: ScimEmail[];
  active?: boolean;
}

export interface ScimGroupInput {
  schemas?: string[];
  externalId?: string | null;
  displayName: string;
  members?: Array<{ value: string; display?: string; type?: string }>;
}

export interface ScimPatchOperation {
  op: 'add' | 'replace' | 'remove';
  path?: string;
  value?: unknown;
}

export interface ScimPatchInput {
  schemas: string[];
  Operations: ScimPatchOperation[];
}

export interface ParsedScimFilter {
  attribute: string;
  value: string;
}

export function parseFilter(
  filter: string | undefined,
  allowed: ReadonlySet<string>,
): ParsedScimFilter | undefined {
  if (!filter) return undefined;
  if (filter.length > 512) {
    throw new ScimException(
      HttpStatus.BAD_REQUEST,
      'Filter exceeds the 512 character limit',
      'invalidFilter',
    );
  }
  const match = filter.match(
    /^\s*([A-Za-z][A-Za-z0-9.]*)\s+eq\s+"((?:[^"\\]|\\["\\/bfnrt]|\\u[0-9A-Fa-f]{4})*)"\s*$/i,
  );
  if (!match) {
    throw new ScimException(
      HttpStatus.BAD_REQUEST,
      'Only a single allowed attribute with the eq operator and a quoted string is supported',
      'invalidFilter',
    );
  }
  const attribute = match[1];
  const canonical = [...allowed].find(
    (candidate) => candidate.toLowerCase() === attribute.toLowerCase(),
  );
  if (!canonical) {
    throw new ScimException(
      HttpStatus.BAD_REQUEST,
      `Filtering by ${attribute} is not supported`,
      'invalidFilter',
    );
  }
  let value: string;
  try {
    value = JSON.parse(`"${match[2]}"`) as string;
  } catch {
    throw new ScimException(
      HttpStatus.BAD_REQUEST,
      'Filter string escaping is invalid',
      'invalidFilter',
    );
  }
  if (!value || value.length > 512) {
    throw new ScimException(
      HttpStatus.BAD_REQUEST,
      'Filter value must contain between 1 and 512 characters',
      'invalidFilter',
    );
  }
  return { attribute: canonical, value };
}

export function parsePagination(startIndex?: string, count?: string) {
  const start = integerQuery(startIndex, 1, 1, 1_000_000, 'startIndex');
  const size = integerQuery(count, 100, 0, 200, 'count');
  return { startIndex: start, count: size, skip: start - 1 };
}

function integerQuery(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new ScimException(
      HttpStatus.BAD_REQUEST,
      `${name} must be an integer`,
      'invalidValue',
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ScimException(
      HttpStatus.BAD_REQUEST,
      `${name} must be between ${minimum} and ${maximum}`,
      'invalidValue',
    );
  }
  return parsed;
}

export function normalizeScimText(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 320) {
    throw new ScimException(
      HttpStatus.BAD_REQUEST,
      `${field} must contain between 1 and 320 characters`,
      'invalidValue',
    );
  }
  return normalized;
}

export function optionalString(
  value: unknown,
  field: string,
  maximum = 512,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new ScimException(
      HttpStatus.BAD_REQUEST,
      `${field} must be a string`,
      'invalidValue',
    );
  }
  const result = value.trim();
  if (result.length > maximum) {
    throw new ScimException(
      HttpStatus.BAD_REQUEST,
      `${field} exceeds the ${maximum} character limit`,
      'invalidValue',
    );
  }
  return result || null;
}

export function validateEmails(value: unknown): ScimEmail[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) {
    throw new ScimException(
      HttpStatus.BAD_REQUEST,
      'emails must be an array with at most 20 entries',
      'invalidValue',
    );
  }
  let primarySeen = false;
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new ScimException(
        HttpStatus.BAD_REQUEST,
        `emails[${index}] must be an object`,
        'invalidValue',
      );
    }
    const email = optionalString(entry.value, `emails[${index}].value`, 320);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ScimException(
        HttpStatus.BAD_REQUEST,
        `emails[${index}].value must be a valid email address`,
        'invalidValue',
      );
    }
    const primary = entry.primary === true;
    if (entry.primary !== undefined && typeof entry.primary !== 'boolean') {
      throw new ScimException(
        HttpStatus.BAD_REQUEST,
        `emails[${index}].primary must be boolean`,
        'invalidValue',
      );
    }
    if (primary && primarySeen) {
      throw new ScimException(
        HttpStatus.BAD_REQUEST,
        'Only one email may be primary',
        'invalidValue',
      );
    }
    primarySeen ||= primary;
    return {
      value: email.toLowerCase(),
      ...(optionalString(entry.type, `emails[${index}].type`, 64)
        ? { type: optionalString(entry.type, `emails[${index}].type`, 64)! }
        : {}),
      ...(primary ? { primary: true } : {}),
    };
  });
}

export function requireRecord(value: unknown, field = 'request body') {
  if (!isRecord(value)) {
    throw new ScimException(
      HttpStatus.BAD_REQUEST,
      `${field} must be an object`,
      'invalidSyntax',
    );
  }
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
