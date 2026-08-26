import { Request } from 'express';
import { ApplicationRole } from '@prisma/client';

export interface Authentication {
  connectionId: string;
  subject: string;
  claims: Readonly<Record<string, unknown>>;
}

export interface AuthenticatedRequest extends Request {
  auth: Authentication;
  tenantId: string;
  tenantRole: ApplicationRole;
}
