import { Injectable, UnauthorizedException } from '@nestjs/common';
import {
  createRemoteJWKSet,
  errors,
  jwtVerify,
  JWTPayload,
  JWTVerifyGetKey,
} from 'jose';

@Injectable()
export class CognitoJwtService {
  private keySet?: JWTVerifyGetKey;

  async verify(token: string): Promise<JWTPayload> {
    const issuer = process.env.COGNITO_ISSUER;
    const clientId = process.env.COGNITO_AUDIENCE;
    if (!issuer || !clientId) {
      throw new UnauthorizedException('Cognito authentication is not configured');
    }

    this.keySet ??= createRemoteJWKSet(
      new URL(`${issuer.replace(/\/$/, '')}/.well-known/jwks.json`),
    );
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.keySet, {
        issuer,
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
    const audience = payload.aud;
    const validIdToken =
      tokenUse === 'id' &&
      (audience === clientId ||
        (Array.isArray(audience) && audience.includes(clientId)));
    const validAccessToken =
      tokenUse === 'access' && payload['client_id'] === clientId;
    if (!validIdToken && !validAccessToken) {
      throw new UnauthorizedException('Token was not issued for this application');
    }
    return payload;
  }
}
