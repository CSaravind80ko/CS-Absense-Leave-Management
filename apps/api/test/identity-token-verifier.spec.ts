import { UnauthorizedException } from '@nestjs/common';
import { generateKeyPair, SignJWT } from 'jose';
import {
  IdentityTokenVerifier,
  type JwksFactory,
} from '../src/auth/identity-token-verifier.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('IdentityTokenVerifier', () => {
  const issuer = 'https://cognito-idp.ap-south-1.amazonaws.com/pool';
  const clientId = 'web-client';

  it('verifies only an active issuer/client connection and caches its JWKS resolver', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const token = await new SignJWT({
      sub: 'immutable-provider-subject',
      token_use: 'access',
      client_id: clientId,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(issuer)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    const findFirst = jest.fn().mockResolvedValue({
      id: 'connection-1',
      issuer,
      clientId,
    });
    const factory = jest.fn(() => async () => publicKey) as JwksFactory;
    const prisma = {
      identityConnection: { findFirst },
    } as unknown as PrismaService;
    const verifier = new IdentityTokenVerifier(prisma, factory);

    await expect(verifier.verify(token)).resolves.toEqual(
      expect.objectContaining({
        connectionId: 'connection-1',
        subject: 'immutable-provider-subject',
      }),
    );
    await verifier.verify(token);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith({
      where: { issuer, clientId: { in: [clientId] }, status: 'ACTIVE' },
      select: { id: true, issuer: true, clientId: true },
    });
  });

  it('rejects unknown issuer/client hints before any JWKS network access', async () => {
    const { privateKey } = await generateKeyPair('RS256');
    const token = await new SignJWT({
      sub: 'user-1',
      token_use: 'access',
      client_id: 'attacker-client',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'attacker-key' })
      .setIssuer('https://attacker.example')
      .setExpirationTime('5m')
      .sign(privateKey);
    const factory = jest.fn() as JwksFactory;
    const prisma = {
      identityConnection: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;

    await expect(
      new IdentityTokenVerifier(prisma, factory).verify(token),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(factory).not.toHaveBeenCalled();
  });
});
