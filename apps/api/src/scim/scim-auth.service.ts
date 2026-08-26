import {
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  ScimException,
  type ScimContext,
  type ScimRequest,
} from './scim-protocol';

interface RateWindow {
  startedAt: number;
  count: number;
}

@Injectable()
export class ScimAuthService {
  private readonly rateWindows = new Map<string, RateWindow>();
  private readonly dummySalt = randomBytes(16).toString('base64url');
  private readonly dummyHash = randomBytes(64);

  constructor(private readonly prisma: PrismaService) {}

  async issue(
    tx: Prisma.TransactionClient,
    input: {
      tenantId: string;
      provisioningConnectionId: string;
      actorSubject: string;
      label: string;
      expiresAt?: Date | null;
    },
  ) {
    const prefix = `scim_${randomBytes(8).toString('hex')}`;
    const token = `${prefix}.${randomBytes(32).toString('base64url')}`;
    const salt = randomBytes(16).toString('base64url');
    const hash = await deriveTokenHash(token, salt);
    const credential = await tx.scimCredential.create({
      data: {
        tenantId: input.tenantId,
        provisioningConnectionId: input.provisioningConnectionId,
        tokenPrefix: prefix,
        tokenHash: hash.toString('base64url'),
        tokenSalt: salt,
        label: input.label,
        expiresAt: input.expiresAt,
        createdBySubject: input.actorSubject,
      },
      select: {
        id: true,
        tokenPrefix: true,
        label: true,
        expiresAt: true,
        createdAt: true,
      },
    });
    return { credential, token };
  }

  async authenticate(
    tenantId: string,
    samlConnectionId: string,
    token: string,
    request: ScimRequest,
  ): Promise<ScimContext> {
    if (token.length > 512) {
      throw new UnauthorizedException('SCIM bearer token is invalid');
    }
    const match = token.match(/^(scim_[0-9a-f]{16})\.([A-Za-z0-9_-]{40,})$/);
    const prefix = match?.[1] ?? '';
    const connection = await this.prisma.scimProvisioningConnection.findFirst({
      where: {
        tenantId,
        samlConnectionId,
        enabled: true,
        samlConnection: { status: 'ACTIVE' },
        identityConnection: { status: 'ACTIVE' },
      },
      select: {
        id: true,
        tenantId: true,
        identityConnectionId: true,
      },
    });
    const credential = connection
      ? await this.prisma.scimCredential.findFirst({
          where: {
            tenantId,
            provisioningConnectionId: connection.id,
            tokenPrefix: prefix,
            revokedAt: null,
          },
          select: {
            id: true,
            tokenHash: true,
            tokenSalt: true,
            expiresAt: true,
            lastUsedAt: true,
          },
        })
      : null;

    const actual = await deriveTokenHash(
      token,
      credential?.tokenSalt ?? this.dummySalt,
    );
    const expected = credential
      ? Buffer.from(credential.tokenHash, 'base64url')
      : this.dummyHash;
    const verified =
      actual.length === expected.length && timingSafeEqual(actual, expected);
    if (
      !match ||
      !connection ||
      !credential ||
      !verified ||
      (credential.expiresAt && credential.expiresAt <= new Date())
    ) {
      throw new UnauthorizedException('SCIM bearer token is invalid or expired');
    }

    this.consumeRateLimit(credential.id);
    const now = new Date();
    if (
      !credential.lastUsedAt ||
      now.getTime() - credential.lastUsedAt.getTime() >= 60_000
    ) {
      await this.prisma.scimCredential.updateMany({
        where: {
          id: credential.id,
          revokedAt: null,
          OR: [
            { lastUsedAt: null },
            { lastUsedAt: { lt: new Date(now.getTime() - 60_000) } },
          ],
        },
        data: {
          lastUsedAt: now,
          lastUsedIp: safeIp(request.ip),
        },
      });
    }
    return {
      tenantId,
      samlConnectionId,
      provisioningConnectionId: connection.id,
      identityConnectionId: connection.identityConnectionId,
      credentialId: credential.id,
    };
  }

  private consumeRateLimit(credentialId: string) {
    const now = Date.now();
    const maximum = positiveInteger(process.env.SCIM_RATE_LIMIT_PER_MINUTE, 120);
    const current = this.rateWindows.get(credentialId);
    if (!current || now - current.startedAt >= 60_000) {
      this.rateWindows.set(credentialId, { startedAt: now, count: 1 });
      return;
    }
    current.count += 1;
    if (current.count > maximum) {
      throw new ScimException(
        HttpStatus.TOO_MANY_REQUESTS,
        'SCIM request rate limit exceeded',
        'tooMany',
      );
    }
  }
}

function deriveTokenHash(token: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(token, salt, 64, { N: 16_384, r: 8, p: 1 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function safeIp(value: string | undefined) {
  return value && value.length <= 64 ? value : null;
}
