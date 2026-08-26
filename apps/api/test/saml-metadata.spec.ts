import { BadRequestException } from '@nestjs/common';
import {
  isPublicIp,
  S3SamlMetadataStorage,
  SamlMetadataFetcher,
  SamlMetadataValidator,
} from '../src/saml-connections/saml-metadata';

const CERTIFICATE =
  'MIIDCTCCAfGgAwIBAgIUMSZDTfkfBQTJlwvEtC8McyvNJQQwDQYJKoZIhvcNAQELBQAwFDESMBAGA1UEAwwJc2FtbC50ZXN0MB4XDTI2MDgyNjA5NTg1NloXDTM2MDgyMzA5NTg1NlowFDESMBAGA1UEAwwJc2FtbC50ZXN0MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvtPXGhN9KuJ18+YlZJoskSDaK6kauPI8A3YKxIBIU0OFcgfIZES/TbkyYbwM1QxqM+hTnPMOkW4+4QmW/629Ph4gqBj1kUTJ+Sm7HDexQJ/rzBaNz064mKyZ8pzUTIiTWC+V3iQlV29D0H8aDCsdqTd4KjbvGqfwIBVCu3sI2ktqlq7UAB0vanACW9WD4MXe0U48JwNUgb35HutqqZTa/MKjpESSB0SF5Zwh3Up3LvI8vENoM7VLgRcZUHYQV848gNCnDOBzzfhxwAvKyVQb/jHXhJktlWR5xqq9h9KbVoF/Fmf3HLN06MCW0iDJEaFb1bu94B9YXy2fUypfsISsBwIDAQABo1MwUTAdBgNVHQ4EFgQUiTteOHVIA/EzmcSSKgsceSu2zgkwHwYDVR0jBBgwFoAUiTteOHVIA/EzmcSSKgsceSu2zgkwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAQoAX+OrScAOC+WbVaegFy/YxWw26SSliqyt5TPOwiS6mfKg9/rtjHIw+ZARqe6+p2vSY9nV7So7ePFBjNbqw3nBu9gk7r5rjVvmc7iyafpyROOKfLrNRwcor1Sk8px7wi0dvzCBYEpm/O1srkC4kw6Mx7XxbUNrFi3owuf1nfxb2yyZYHMV7RDmPkzDprR5PGEpkCp46h9V6BiXbwSZ8Zvak5kk+wUsDvMi47jA17wyXVXt4WALmJ1n7cB/EZjaOWBJwVaNJCoYZ6/y9RuPX0Wve3Fl48XYO43IOuXPjsD9tV7Wie2gpQLUdsXmGprYfhKDg6IMLcbQGObh9Oz2XdQ==';
const EXPIRED_CERTIFICATE =
  'MIICzDCCAbSgAwIBAgIBATANBgkqhkiG9w0BAQsFADAYMRYwFAYDVQQDDA1yb2xsb3Zlci50ZXN0MB4XDTIwMDEwMTAwMDAwMFoXDTIxMDEwMTAwMDAwMFowGDEWMBQGA1UEAwwNcm9sbG92ZXIudGVzdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALO/d8F6OTZiRTB1+A99ijr8zuk76n1ft3eP3pilBndLLCkiPef2dFO82lcq6qkGaS9W5c8QG9a9vcLPMZ/HpT2fpolo0QwcaGRS3XCly6+9Sy1JpGTVqw5TuTpFO5YmQDcIfbh9PnyGpWPzcAF0SYw7cmTHjOhMCdhcItX4t5awcmwcg5WUgEH/F87DpWxyNz1TXW+Jazu+wwbbl/WxL4GGdO9FIZGUvrqISFnvOHGjANUmnyna1SLyeXOF6TEpdO//PW4KWUwx0+xhMURL17fBn0uVJE9Smt3PJbuL2LaZC+0IU7D7BiCHjETzHXvaqvTckQPX3rGnPYcOWl4tmdsCAwEAAaMhMB8wHQYDVR0OBBYEFHREeRj/dk30XA9jtM4FP1ZXhGaAMA0GCSqGSIb3DQEBCwUAA4IBAQA0mZA5IjWDQb1+Vchdh53qollhX8ls75XKnkA/YdtYLloIsNwbBTusCJUVjuNtO1S3NZq6Ha9NrudbGEaHPl9EMeL31jrADapWfw4kLH+jwRd9nuYDM5VfzLybI29zAekciWhcU0DWaQWbSxbtSqW6pMglSDbwnKMDFK1gx8mDChabokVSxDKS9rRLu6cySmnDgithulwyfT0wjsZn2FefWyVcRoHTRRtqDHMDaWDcOD1PEgX4AVF3YT+9tiw7LcdVWlSsmcoDt+87ArF9aJINOEHZB89hogdyjApgBLIpN3Sr8FJgdCLIxEzKyT7OxPs8d+dooUWgAMgWscVqe75S';
const FUTURE_CERTIFICATE =
  'MIICzDCCAbSgAwIBAgIBAjANBgkqhkiG9w0BAQsFADAYMRYwFAYDVQQDDA1yb2xsb3Zlci50ZXN0MB4XDTMwMDEwMTAwMDAwMFoXDTQwMDEwMTAwMDAwMFowGDEWMBQGA1UEAwwNcm9sbG92ZXIudGVzdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALO/d8F6OTZiRTB1+A99ijr8zuk76n1ft3eP3pilBndLLCkiPef2dFO82lcq6qkGaS9W5c8QG9a9vcLPMZ/HpT2fpolo0QwcaGRS3XCly6+9Sy1JpGTVqw5TuTpFO5YmQDcIfbh9PnyGpWPzcAF0SYw7cmTHjOhMCdhcItX4t5awcmwcg5WUgEH/F87DpWxyNz1TXW+Jazu+wwbbl/WxL4GGdO9FIZGUvrqISFnvOHGjANUmnyna1SLyeXOF6TEpdO//PW4KWUwx0+xhMURL17fBn0uVJE9Smt3PJbuL2LaZC+0IU7D7BiCHjETzHXvaqvTckQPX3rGnPYcOWl4tmdsCAwEAAaMhMB8wHQYDVR0OBBYEFHREeRj/dk30XA9jtM4FP1ZXhGaAMA0GCSqGSIb3DQEBCwUAA4IBAQBTOF5yH1RhJ8PsJEzW0H9zMyOFJQ3N5Wf3rfl71orViQT96e4HtyUl8Pf6hT70BKR1Vn5NEBSlU/tF/0V3YtyFqd90hjQ4DcO6geybLhEY7tdaYapfjuGAZv3CIlPnYKNDl81de4TNwVLhNEil/2c+CH2fHnBgvZaw/okhxixVWbJ1eofoVTc6CwYUtlezu4SQ6TL6Vsw9LDNBYQQoI5wk/ex6TcorLSWAnyVuPSQzv23hmcaucTECXeox2B/jZL3aRpYRO99gOW5wxURcAk/tBsp1whiWnyeCkJ5ZWqKVVkn2DnjYf55lRRwl/7DsPkddhZ/K62uxwSCaSVABzIr7';

function metadata(
  certificate: string | string[] = CERTIFICATE,
  location: string | null = 'https://idp.example.test/sso',
): string {
  const locationAttribute =
    location === null ? '' : ` Location="${location}"`;
  const certificates = (Array.isArray(certificate)
    ? certificate
    : [certificate]
  )
    .map(
      (item) =>
        `<KeyDescriptor use="signing"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>${item}</X509Certificate></X509Data></KeyInfo></KeyDescriptor>`,
    )
    .join('');
  return `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.example.test/entity">
    <IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
      ${certificates}
      <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"${locationAttribute}/>
    </IDPSSODescriptor>
  </EntityDescriptor>`;
}

describe('SamlMetadataValidator', () => {
  const validator = new SamlMetadataValidator();

  it('extracts entity ID and normalized SHA-256 certificate details', () => {
    const result = validator.validate(metadata());

    expect(result.entityId).toBe('https://idp.example.test/entity');
    expect(result.fingerprints[0]).toMatch(
      /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/,
    );
    expect(result.certificates[0]).toEqual(
      expect.objectContaining({
        subject: 'CN=saml.test',
        derBase64: CERTIFICATE,
        validFrom: expect.any(String),
        validTo: expect.any(String),
      }),
    );
  });

  it.each([
    '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>',
    metadata('not-a-certificate'),
    '<EntityDescriptor entityID="x"></EntityDescriptor>',
  ])('rejects unsafe or incomplete metadata', (xml) => {
    expect(() => validator.validate(xml)).toThrow(BadRequestException);
  });

  it.each([
    null,
    'not-a-url',
    'http://idp.example.test/sso',
    'ftp://idp.example.test/sso',
  ])('rejects a missing or unsafe SSO Location: %s', (location) => {
    expect(() => validator.validate(metadata(CERTIFICATE, location))).toThrow(
      BadRequestException,
    );
  });

  it.each([
    'http://localhost/sso',
    'http://127.0.0.1:8080/sso',
    'http://[::1]/sso',
  ])('allows a local HTTP SSO Location only behind the development flag', (location) => {
    const previousEnvironment = process.env.NODE_ENV;
    const previousFlag = process.env.SAML_ALLOW_INSECURE_LOCALHOST;
    process.env.NODE_ENV = 'test';
    process.env.SAML_ALLOW_INSECURE_LOCALHOST = 'true';
    try {
      expect(
        validator.validate(metadata(CERTIFICATE, location)).entityId,
      ).toBe('https://idp.example.test/entity');
      process.env.NODE_ENV = 'production';
      expect(() =>
        validator.validate(metadata(CERTIFICATE, location)),
      ).toThrow(BadRequestException);
    } finally {
      if (previousEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnvironment;
      if (previousFlag === undefined) {
        delete process.env.SAML_ALLOW_INSECURE_LOCALHOST;
      } else {
        process.env.SAML_ALLOW_INSECURE_LOCALHOST = previousFlag;
      }
    }
  });

  it.each(['2026-08-25T00:00:00Z', '2037-01-01T00:00:00Z'])(
    'requires one currently valid certificate at %s',
    (now) => {
    jest.useFakeTimers().setSystemTime(new Date(now));
    try {
      expect(() => validator.validate(metadata())).toThrow(
        'at least one currently valid',
      );
    } finally {
      jest.useRealTimers();
    }
    },
  );

  it('accepts expired and future rollover certificates alongside a valid certificate', () => {
    const result = validator.validate(
      metadata([EXPIRED_CERTIFICATE, CERTIFICATE, FUTURE_CERTIFICATE]),
    );

    expect(result.certificates.map((item) => item.validityState)).toEqual([
      'EXPIRED',
      'VALID',
      'NOT_YET_VALID',
    ]);
  });

  it('does not accept an unrelated valid certificate from Extensions for an expired IdP role', () => {
    const xml = `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.example.test/entity">
      <Extensions>
        <KeyDescriptor use="signing"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>${CERTIFICATE}</X509Certificate></X509Data></KeyInfo></KeyDescriptor>
      </Extensions>
      <IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
        <KeyDescriptor use="signing"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>${EXPIRED_CERTIFICATE}</X509Certificate></X509Data></KeyInfo></KeyDescriptor>
        <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="https://idp.example.test/sso"/>
      </IDPSSODescriptor>
    </EntityDescriptor>`;

    expect(() => validator.validate(xml)).toThrow(
      'at least one currently valid signing certificate',
    );
  });
});

describe('S3SamlMetadataStorage', () => {
  it('lets the bucket default control server-side encryption', async () => {
    const previousBucket = process.env.SAML_METADATA_BUCKET;
    const previousRegion = process.env.SAML_METADATA_REGION;
    process.env.SAML_METADATA_BUCKET = 'metadata-bucket';
    process.env.SAML_METADATA_REGION = 'ap-south-1';
    const send = jest.fn().mockResolvedValue({});
    const storage = new S3SamlMetadataStorage(() => ({
      send,
    }) as never);
    try {
      await storage.put('tenant-a', 'connection-a', '<metadata/>');
      const command = send.mock.calls[0][0] as {
        input: Record<string, unknown>;
      };
      expect(command.input).not.toHaveProperty('ServerSideEncryption');
    } finally {
      if (previousBucket === undefined) delete process.env.SAML_METADATA_BUCKET;
      else process.env.SAML_METADATA_BUCKET = previousBucket;
      if (previousRegion === undefined) delete process.env.SAML_METADATA_REGION;
      else process.env.SAML_METADATA_REGION = previousRegion;
    }
  });
});

describe('SamlMetadataFetcher SSRF defenses', () => {
  const response = (
    status: number,
    headers: Record<string, string> = {},
    body = '',
  ) => ({
    status,
    headers: new Headers(headers),
    body: (async function* () {
      if (body) yield Buffer.from(body);
    })(),
    cancel: jest.fn(),
  });

  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '100.64.0.1',
    '169.254.169.254',
    '192.168.1.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
  ])('classifies %s as non-public', (address) => {
    expect(isPublicIp(address)).toBe(false);
  });

  it('rejects when any resolved address is private before fetching', async () => {
    const fetcher = jest.fn();
    const service = new SamlMetadataFetcher(
      async () => ['203.0.113.2', '10.0.0.2'],
      fetcher,
    );

    await expect(
      service.fetch('https://metadata.example.test/saml.xml'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('manually revalidates redirect destinations', async () => {
    const fetcher = jest.fn().mockResolvedValue(
      response(302, {
        location: 'https://internal.example.test/metadata',
      }),
    );
    const resolver = jest.fn(async (hostname: string) =>
      hostname === 'metadata.example.test'
        ? ['8.8.8.8']
        : ['169.254.169.254'],
    );
    const service = new SamlMetadataFetcher(resolver, fetcher);

    await expect(
      service.fetch('https://metadata.example.test/saml.xml'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it('destroys a non-success response body before rejecting it', async () => {
    const failed = response(503);
    const service = new SamlMetadataFetcher(
      async () => ['8.8.8.8'],
      jest.fn().mockResolvedValue(failed),
    );

    await expect(
      service.fetch('https://metadata.example.test/saml.xml'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(failed.cancel).toHaveBeenCalledTimes(1);
  });

  it('pins the request to the exact address that passed validation', async () => {
    const fetcher = jest.fn().mockResolvedValue(
      response(200, { 'content-length': '6' }, '<xml/>'),
    );
    const resolver = jest.fn().mockResolvedValue(['8.8.8.8', '1.1.1.1']);
    const service = new SamlMetadataFetcher(resolver, fetcher);

    await expect(
      service.fetch('https://metadata.example.test/saml.xml'),
    ).resolves.toBe('<xml/>');
    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.objectContaining({
          hostname: 'metadata.example.test',
        }),
        address: '8.8.8.8',
      }),
    );
  });
});
