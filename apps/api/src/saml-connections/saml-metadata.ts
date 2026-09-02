import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { createHash, X509Certificate } from 'crypto';
import { lookup } from 'dns/promises';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { isIP } from 'net';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export const SAML_DNS_RESOLVER = Symbol('SAML_DNS_RESOLVER');
export const SAML_FETCH = Symbol('SAML_FETCH');
export const SAML_METADATA_STORAGE = Symbol('SAML_METADATA_STORAGE');
export const SAML_S3_CLIENT_FACTORY = Symbol('SAML_S3_CLIENT_FACTORY');

export type SamlDnsResolver = (hostname: string) => Promise<string[]>;
export interface SamlPinnedFetchRequest {
  url: URL;
  address: string;
  signal: AbortSignal;
  headers: Record<string, string>;
}

export interface SamlFetchResponse {
  status: number;
  headers: Headers;
  body: AsyncIterable<Uint8Array>;
  cancel(): void;
}

export type SamlFetch = (
  request: SamlPinnedFetchRequest,
) => Promise<SamlFetchResponse>;
export type SamlS3Client = Pick<S3Client, 'send'>;
export type SamlS3ClientFactory = (region: string) => SamlS3Client;

export interface SamlMetadataStorage {
  put(tenantId: string, connectionId: string, xml: string): Promise<string>;
  get(reference: string): Promise<string>;
}

export interface SamlCertificateDetails {
  fingerprintSha256: string;
  derBase64: string;
  subject?: string;
  issuer?: string;
  serialNumber?: string;
  validFrom?: string;
  validTo?: string;
  validityState: 'VALID' | 'NOT_YET_VALID' | 'EXPIRED';
}

export interface ValidatedSamlMetadata {
  entityId: string;
  certificates: SamlCertificateDetails[];
  fingerprints: string[];
  xml: string;
}

const defaultResolver: SamlDnsResolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map(
    (record) => record.address,
  );

const pinnedNodeFetch: SamlFetch = ({ url, address, signal, headers }) =>
  new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        method: 'GET',
        headers,
        signal,
        servername:
          url.protocol === 'https:'
            ? stripIpv6Brackets(url.hostname)
            : undefined,
        lookup: (_hostname, _options, callback) => {
          callback(null, address, isIP(address));
        },
      },
      (response) => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) {
            for (const item of value) responseHeaders.append(name, item);
          } else if (value !== undefined) {
            responseHeaders.set(name, String(value));
          }
        }
        resolve({
          status: response.statusCode ?? 0,
          headers: responseHeaders,
          body: response,
          cancel: () => response.destroy(),
        });
      },
    );
    request.once('error', reject);
    request.end();
  });

const defaultS3Factory: SamlS3ClientFactory = (region) => {
  const config: S3ClientConfig = { region };
  return new S3Client(config);
};

@Injectable()
export class SamlMetadataValidator {
  validate(xml: string): ValidatedSamlMetadata {
    const maximum = positiveInteger(
      process.env.SAML_METADATA_MAX_BYTES,
      1024 * 1024,
    );
    if (Buffer.byteLength(xml, 'utf8') > maximum) {
      throw new BadRequestException(
        `SAML metadata exceeds the ${maximum} byte limit`,
      );
    }
    if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) {
      throw new BadRequestException(
        'SAML metadata must not contain DOCTYPE or ENTITY declarations',
      );
    }
    const validation = XMLValidator.validate(xml);
    if (validation !== true) {
      throw new BadRequestException('SAML metadata is not well-formed XML');
    }

    let document: unknown;
    try {
      document = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        removeNSPrefix: true,
        trimValues: true,
      }).parse(xml);
    } catch {
      throw new BadRequestException('SAML metadata is not well-formed XML');
    }
    const descriptor = findNamedObject(document, 'EntityDescriptor');
    const entityId = stringAttribute(descriptor, 'entityID');
    if (!descriptor || !entityId) {
      throw new BadRequestException(
        'SAML metadata requires an EntityDescriptor entityID',
      );
    }
    const idpRoles = directNamedObjects(descriptor, 'IDPSSODescriptor');
    if (idpRoles.length === 0) {
      throw new BadRequestException(
        'SAML metadata requires an IDPSSODescriptor',
      );
    }
    const services = idpRoles.flatMap((role) =>
      directNamedObjects(role, 'SingleSignOnService'),
    );
    const supported = services.some((service) => {
      const binding = stringAttribute(service, 'Binding');
      const location = stringAttribute(service, 'Location');
      return (
        (binding?.endsWith(':HTTP-Redirect') ||
          binding?.endsWith(':HTTP-POST')) &&
        isAllowedSsoLocation(location)
      );
    });
    if (!supported) {
      throw new BadRequestException(
        'SAML metadata requires an HTTP-Redirect or HTTP-POST SingleSignOnService with a valid HTTPS Location',
      );
    }

    const certificateValues = findSigningCertificates(idpRoles);
    if (certificateValues.length === 0) {
      throw new BadRequestException(
        'SAML metadata requires at least one signing certificate',
      );
    }
    const certificates = certificateValues.map((value) =>
      this.parseCertificate(value),
    );
    const deduplicated = [
      ...new Map(
        certificates.map((certificate) => [
          certificate.fingerprintSha256,
          certificate,
        ]),
      ).values(),
    ];
    if (
      !deduplicated.some(
        (certificate) => certificate.validityState === 'VALID',
      )
    ) {
      throw new BadRequestException(
        'SAML metadata requires at least one currently valid signing certificate',
      );
    }
    return {
      entityId,
      certificates: deduplicated,
      fingerprints: deduplicated.map(
        (certificate) => certificate.fingerprintSha256,
      ),
      xml,
    };
  }

  private parseCertificate(value: string): SamlCertificateDetails {
    const normalized = value.replace(/\s+/g, '');
    if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
      throw new BadRequestException(
        'SAML metadata contains an invalid signing certificate',
      );
    }
    const der = Buffer.from(normalized, 'base64');
    if (der.length === 0) {
      throw new BadRequestException(
        'SAML metadata contains an invalid signing certificate',
      );
    }
    const fingerprintSha256 = createHash('sha256')
      .update(der)
      .digest('hex')
      .toUpperCase()
      .match(/.{2}/g)!
      .join(':');
    try {
      const certificate = new X509Certificate(der);
      const validFrom = new Date(certificate.validFrom);
      const validTo = new Date(certificate.validTo);
      const now = new Date();
      const validityState =
        validFrom > now
          ? 'NOT_YET_VALID'
          : validTo < now
            ? 'EXPIRED'
            : 'VALID';
      return {
        fingerprintSha256,
        derBase64: der.toString('base64'),
        subject: certificate.subject,
        issuer: certificate.issuer,
        serialNumber: certificate.serialNumber,
        validFrom: validFrom.toISOString(),
        validTo: validTo.toISOString(),
        validityState,
      };
    } catch {
      throw new BadRequestException(
        'SAML metadata contains an invalid X.509 signing certificate',
      );
    }
  }
}

@Injectable()
export class SamlMetadataFetcher {
  constructor(
    @Optional()
    @Inject(SAML_DNS_RESOLVER)
    private readonly resolver: SamlDnsResolver = defaultResolver,
    @Optional()
    @Inject(SAML_FETCH)
    private readonly fetcher: SamlFetch = pinnedNodeFetch,
  ) {}

  async fetch(url: string): Promise<string> {
    const maximum = positiveInteger(
      process.env.SAML_METADATA_MAX_BYTES,
      1024 * 1024,
    );
    let current = url;
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      const target = await this.validateUrl(current);
      const parsed = target.url;
      const pinnedAddress = target.addresses[0];
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        positiveInteger(process.env.SAML_FETCH_TIMEOUT_MS, 5000),
      );
      let response: SamlFetchResponse;
      try {
        response = await this.fetcher({
          url: parsed,
          address: pinnedAddress,
          signal: controller.signal,
          headers: { Accept: 'application/samlmetadata+xml, application/xml, text/xml' },
        });
      } catch (error) {
        clearTimeout(timeout);
        throw new ServiceUnavailableException(
          `Unable to retrieve SAML metadata: ${errorMessage(error)}`,
        );
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        clearTimeout(timeout);
        response.cancel();
        const location = response.headers.get('location');
        if (!location || redirects === 3) {
          throw new BadRequestException(
            'SAML metadata redirect limit was exceeded',
          );
        }
        current = new URL(location, parsed).toString();
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        clearTimeout(timeout);
        response.cancel();
        throw new BadRequestException(
          `SAML metadata endpoint returned HTTP ${response.status}`,
        );
      }
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maximum) {
        clearTimeout(timeout);
        response.cancel();
        throw new BadRequestException(
          `SAML metadata exceeds the ${maximum} byte limit`,
        );
      }
      try {
        const chunks: Uint8Array[] = [];
        let size = 0;
        for await (const value of response.body) {
          const chunk =
            value instanceof Uint8Array ? value : Buffer.from(value);
          size += chunk.byteLength;
          if (size > maximum) {
            response.cancel();
            throw new BadRequestException(
              `SAML metadata exceeds the ${maximum} byte limit`,
            );
          }
          chunks.push(chunk);
        }
        return Buffer.concat(chunks).toString('utf8');
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        throw new ServiceUnavailableException(
          `Unable to read SAML metadata: ${errorMessage(error)}`,
        );
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new BadRequestException('SAML metadata redirect limit was exceeded');
  }

  private async validateUrl(
    value: string,
  ): Promise<{ url: URL; addresses: string[] }> {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new BadRequestException('SAML metadata URL is invalid');
    }
    const insecureLocalhost =
      process.env.NODE_ENV !== 'production' &&
      process.env.SAML_ALLOW_INSECURE_LOCALHOST === 'true' &&
      isLoopbackHostname(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && insecureLocalhost)) {
      throw new BadRequestException('SAML metadata URL must use HTTPS');
    }
    if (url.username || url.password) {
      throw new BadRequestException(
        'SAML metadata URL must not contain credentials',
      );
    }
    const addresses = isIP(stripIpv6Brackets(url.hostname))
      ? [stripIpv6Brackets(url.hostname)]
      : await this.resolve(url.hostname);
    const addressesAllowed = insecureLocalhost
      ? addresses.length > 0 && addresses.every(isLoopbackIp)
      : addresses.length > 0 && addresses.every(isPublicIp);
    if (!addressesAllowed) {
      throw new BadRequestException(
        'SAML metadata URL resolves to a non-public address',
      );
    }
    return { url, addresses };
  }

  private async resolve(hostname: string): Promise<string[]> {
    try {
      return await this.resolver(hostname);
    } catch (error) {
      throw new BadRequestException(
        `SAML metadata hostname could not be resolved: ${errorMessage(error)}`,
      );
    }
  }
}

@Injectable()
export class S3SamlMetadataStorage implements SamlMetadataStorage {
  private readonly clients = new Map<string, SamlS3Client>();

  constructor(
    @Optional()
    @Inject(SAML_S3_CLIENT_FACTORY)
    private readonly factory: SamlS3ClientFactory = defaultS3Factory,
  ) {}

  async put(
    tenantId: string,
    connectionId: string,
    xml: string,
  ): Promise<string> {
    const { bucket, region } = this.configuration();
    const digest = createHash('sha256').update(xml).digest('hex');
    const key = `saml-metadata/${tenantId}/${connectionId}/${digest}.xml`;
    await this.client(region).send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: xml,
        ContentType: 'application/samlmetadata+xml',
      }),
    );
    return key;
  }

  async get(reference: string): Promise<string> {
    const { bucket, region } = this.configuration();
    const response = await this.client(region).send(
      new GetObjectCommand({ Bucket: bucket, Key: reference }),
    );
    const body = (response as { Body?: { transformToString?: () => Promise<string> } })
      .Body;
    if (!body?.transformToString) {
      throw new ServiceUnavailableException('Stored SAML metadata is unavailable');
    }
    return body.transformToString();
  }

  private configuration(): { bucket: string; region: string } {
    const bucket = process.env.SAML_METADATA_BUCKET?.trim();
    if (!bucket) {
      throw new ServiceUnavailableException(
        'SAML_METADATA_BUCKET is not configured',
      );
    }
    return {
      bucket,
      region:
        process.env.SAML_METADATA_REGION?.trim() ||
        process.env.AWS_REGION?.trim() ||
        'us-east-1',
    };
  }

  private client(region: string): SamlS3Client {
    const existing = this.clients.get(region);
    if (existing) return existing;
    const client = this.factory(region);
    this.clients.set(region, client);
    return client;
  }
}

export function isPublicIp(address: string): boolean {
  const candidate = stripIpv6Brackets(address).toLowerCase();
  if (candidate.startsWith('::ffff:')) {
    return isPublicIp(candidate.slice(7));
  }
  if (isIP(candidate) === 4) {
    const [a, b, c] = candidate.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (isIP(candidate) === 6) {
    const value = ipv6BigInt(candidate);
    if (value === null) return false;
    return ![
      ['::', 128],
      ['::1', 128],
      ['::ffff:0:0', 96],
      ['64:ff9b:1::', 48],
      ['100::', 64],
      ['2001::', 23],
      ['2001:db8::', 32],
      ['2002::', 16],
      ['3fff::', 20],
      ['5f00::', 16],
      ['fc00::', 7],
      ['fe80::', 10],
      ['ff00::', 8],
    ].some(([network, prefix]) =>
      inIpv6Cidr(value, network as string, prefix as number),
    );
  }
  return false;
}

function findSigningCertificates(roles: Record<string, unknown>[]): string[] {
  const values: string[] = [];
  for (const role of roles) {
    for (const descriptor of directNamedObjects(role, 'KeyDescriptor')) {
      const use = stringAttribute(descriptor, 'use');
      if (use && use !== 'signing') continue;
      for (const certificate of findNamedObjects(
        descriptor,
        'X509Certificate',
      )) {
        if (typeof certificate === 'string') values.push(certificate);
      }
    }
  }
  return values;
}

function directNamedObjects(
  value: Record<string, unknown>,
  name: string,
): Record<string, unknown>[] {
  const child = value[name];
  const children = Array.isArray(child) ? child : child === undefined ? [] : [child];
  return children.filter(isRecord);
}

function findNamedObject(
  value: unknown,
  name: string,
): Record<string, unknown> | undefined {
  return findNamedObjects(value, name).find(
    (item): item is Record<string, unknown> =>
      typeof item === 'object' && item !== null,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function findNamedObjects(value: unknown, name: string): unknown[] {
  const matches: unknown[] = [];
  if (Array.isArray(value)) {
    for (const item of value) matches.push(...findNamedObjects(item, name));
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      if (key === name) {
        matches.push(...(Array.isArray(child) ? child : [child]));
      }
      matches.push(...findNamedObjects(child, name));
    }
  }
  return matches;
}

function stringAttribute(
  value: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  const attribute = value?.[`@_${name}`];
  return typeof attribute === 'string' ? attribute.trim() : undefined;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function stripIpv6Brackets(value: string): string {
  return value.replace(/^\[|\]$/g, '');
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = stripIpv6Brackets(hostname).toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    isLoopbackIp(normalized)
  );
}

function isAllowedSsoLocation(value: string | undefined): boolean {
  if (!value) return false;
  let location: URL;
  try {
    location = new URL(value);
  } catch {
    return false;
  }
  if (location.username || location.password) return false;
  if (location.protocol === 'https:') return true;
  if (
    location.protocol !== 'http:' ||
    process.env.NODE_ENV === 'production' ||
    process.env.SAML_ALLOW_INSECURE_LOCALHOST !== 'true'
  ) {
    return false;
  }
  const hostname = stripIpv6Brackets(location.hostname).toLowerCase();
  return ['localhost', '127.0.0.1', '::1'].includes(hostname);
}

function isLoopbackIp(address: string): boolean {
  const normalized = stripIpv6Brackets(address).toLowerCase();
  if (normalized.startsWith('127.')) return true;
  return isIP(normalized) === 6 && ipv6BigInt(normalized) === 1n;
}

function ipv6BigInt(address: string): bigint | null {
  if (isIP(address) !== 6) return null;
  const [headPart, tailPart] = address.split('::');
  const head = headPart ? headPart.split(':') : [];
  const tail = tailPart ? tailPart.split(':') : [];
  const expandIpv4 = (parts: string[]): string[] =>
    parts.flatMap((part) => {
      if (!part.includes('.')) return [part];
      const bytes = part.split('.').map(Number);
      return [
        ((bytes[0] << 8) | bytes[1]).toString(16),
        ((bytes[2] << 8) | bytes[3]).toString(16),
      ];
    });
  const expandedHead = expandIpv4(head);
  const expandedTail = expandIpv4(tail);
  const missing = 8 - expandedHead.length - expandedTail.length;
  const groups = [
    ...expandedHead,
    ...Array(Math.max(0, missing)).fill('0'),
    ...expandedTail,
  ];
  if (groups.length !== 8) return null;
  return groups.reduce(
    (value, group) => (value << 16n) | BigInt(parseInt(group, 16)),
    0n,
  );
}

function inIpv6Cidr(
  address: bigint,
  network: string,
  prefix: number,
): boolean {
  const networkValue = ipv6BigInt(network);
  if (networkValue === null) return false;
  const shift = BigInt(128 - prefix);
  return address >> shift === networkValue >> shift;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
