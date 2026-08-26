import {
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  createRemoteJWKSet,
  decodeJwt,
  errors,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';

export const IDENTITY_JWKS_FACTORY = Symbol('IDENTITY_JWKS_FACTORY');

export type JwksFactory = (url: URL) => JWTVerifyGetKey;

export interface VerifiedIdentityToken {
  connectionId: string;
  subject: string;
  claims: JWTPayload;
}

const remoteJwksFactory: JwksFactory = (url) =>
  createRemoteJWKSet(url, {
    cacheMaxAge: 60 * 60 * 1_000,
    cooldownDuration: 30_000,
    timeoutDuration: 5_000,
  });

@Injectable()
export class IdentityTokenVerifier {
  private readonly keySets = new Map<string, JWTVerifyGetKey>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(IDENTITY_JWKS_FACTORY)
    private readonly jwksFactory: JwksFactory = remoteJwksFactory,
  ) {}

  async verify(token: string): Promise<VerifiedIdentityToken> {
    const hints = this.decodeHints(token);
    const connection = await this.prisma.identityConnection.findFirst({
      where: {
        issuer: hints.issuer,
        clientId: { in: hints.clientIds },
        status: 'ACTIVE',
      },
      select: { id: true, issuer: true, clientId: true },
    });
    if (!connection) {
      throw new UnauthorizedException('Token issuer is not configured');
    }

    const keySet =
      this.keySets.get(connection.issuer) ??
      this.createAndCacheKeySet(connection.issuer);
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, keySet, {
        issuer: connection.issuer,
        algorithms: ['RS256'],
      }));
    } catch (error: unknown) {
      if (error instanceof errors.JOSEError) {
        throw new UnauthorizedException('Token is invalid or expired');
      }
      throw error;
    }

    if (!payload.sub) {
      throw new UnauthorizedException('Token has no subject');
    }
    const tokenUse = payload['token_use'];
    const validIdToken =
      tokenUse === 'id' && this.audienceIncludes(payload.aud, connection.clientId);
    const validAccessToken =
      tokenUse === 'access' && payload['client_id'] === connection.clientId;
    if (!validIdToken && !validAccessToken) {
      throw new UnauthorizedException('Token was not issued for this application');
    }

    return {
      connectionId: connection.id,
      subject: payload.sub,
      claims: payload,
    };
  }

  private decodeHints(token: string): { issuer: string; clientIds: string[] } {
    try {
      const payload = decodeJwt(token);
      if (typeof payload.iss !== 'string') throw new Error('missing issuer');
      const clientIds = new Set<string>();
      if (typeof payload.client_id === 'string') clientIds.add(payload.client_id);
      if (typeof payload.aud === 'string') clientIds.add(payload.aud);
      if (Array.isArray(payload.aud)) {
        payload.aud
          .filter((value): value is string => typeof value === 'string')
          .forEach((value) => clientIds.add(value));
      }
      if (clientIds.size === 0) throw new Error('missing client');
      return { issuer: payload.iss, clientIds: [...clientIds] };
    } catch {
      throw new UnauthorizedException('Token has invalid identity hints');
    }
  }

  private createAndCacheKeySet(issuer: string): JWTVerifyGetKey {
    const keySet = this.jwksFactory(
      new URL(`${issuer.replace(/\/$/, '')}/.well-known/jwks.json`),
    );
    this.keySets.set(issuer, keySet);
    return keySet;
  }

  private audienceIncludes(
    audience: string | string[] | undefined,
    clientId: string,
  ): boolean {
    return audience === clientId || Boolean(audience?.includes(clientId));
  }
}
