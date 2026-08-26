import { Request } from 'express';

export interface Authentication {
  subject: string;
  claims: Readonly<Record<string, unknown>>;
}

export interface AuthenticatedRequest extends Request {
  auth: Authentication;
  tenantId: string;
}
