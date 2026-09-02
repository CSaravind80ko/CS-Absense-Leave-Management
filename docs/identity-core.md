# Enterprise identity core contracts

This is layer 1 of the enterprise identity stack. Cognito remains the identity broker. Standard tenants use one shared pool; enterprise tenants may point at dedicated pools through `IdentityConnection`.

## Connection record

Later layers must create or update an `IdentityConnection` with:

- `type`: `SHARED_COGNITO` or `DEDICATED_COGNITO`
- `status`: `ACTIVE` only after the provider and app client are ready
- `issuer`: exact Cognito token issuer
- `clientId`: public OIDC app client expected in `client_id`/`aud`
- `authorizationEndpoint`, `tokenEndpoint`, `endSessionEndpoint`: managed-login endpoints
- `discoverySlug` and normalized lowercase `verifiedDomains`: safe pre-login routing keys
- `tenantId`: required by convention for `DEDICATED_COGNITO`, null for the shared connection
- `clientSecretReference`: an optional secret-manager reference only; never secret material
- `cognitoUserPoolId` and `awsRegion`: backend-only routing for Cognito Admin APIs
- `mfaPolicy`: must reflect whether the pool enforces MFA (`REQUIRED`) or merely supports it (`OPTIONAL`)

Exactly one active shared connection should have `isDefault=true`.

## Discovery API

`POST /api/v1/identity/discovery`

Request:

```json
{ "organization": "tenant-slug-or.example-domain" }
```

Response:

```json
{
  "issuer": "https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_example",
  "clientId": "public-client-id",
  "authorizationEndpoint": "https://example.auth.ap-south-1.amazoncognito.com/oauth2/authorize",
  "tokenEndpoint": "https://example.auth.ap-south-1.amazoncognito.com/oauth2/token",
  "endSessionEndpoint": "https://example.auth.ap-south-1.amazoncognito.com/logout",
  "scopes": ["openid", "email", "profile"]
}
```

The endpoint never returns tenant metadata or whether a routing key matched. Unknown inputs use the default shared connection.

## Verified identity and membership contract

After token verification, request authentication contains:

```ts
{
  connectionId: string
  subject: string
  claims: Readonly<Record<string, unknown>>
}
```

Authorization uses the composite identity `(connectionId, subject)`. Tenant authorization additionally binds `tenantId` through `ExternalIdentity`. Email, domain, display name, and custom token claims are not identity keys.

SCIM provisioning in a later layer must create or locate a `TenantMembership`, then create an immutable `ExternalIdentity` with `connectionId`, Cognito `providerSubject`, `tenantId`, and `tenantMembershipId`. It must not mutate an existing mapping to point to a different subject or membership.

Layer 3 implements that contract in [SCIM 2.0 provisioning](scim-provisioning.md).

For managed local users, `providerUsername` stores the Cognito administrative username separately from immutable `providerSubject`. SAML and SCIM layers must preserve that distinction.

## Tenant administration API

All routes require an authenticated `TENANT_ADMIN` and `X-Tenant-Id`:

- `GET /api/v1/tenant-users`
- `POST /api/v1/tenant-users/invitations`
- `PATCH /api/v1/tenant-users/:id/role`
- `PATCH /api/v1/tenant-users/:id/mfa-policy`
- `POST /api/v1/tenant-users/:id/disable`
- `POST /api/v1/tenant-users/:id/enable`
- `POST /api/v1/tenant-users/:id/resend-invitation`
- `POST /api/v1/tenant-users/:id/reset-password`

The backend selects an ACTIVE dedicated connection linked to the tenant first, otherwise the ACTIVE default shared connection. Dedicated-pool ARNs must be added to the API task role deployment configuration before activation.

Shared-pool account lifecycle is tenant-safe: application membership can always be disabled independently, Cognito is disabled only when no other active tenant mapping exists, and account-wide invitation/password recovery is rejected when mappings span tenants.

## SAML layer boundary

The SAML onboarding layer owns Cognito identity-provider configuration and metadata validation. Once onboarding succeeds, it must activate a dedicated connection record matching the connection contract above. The browser and API need no SAML-specific branches: Cognito Managed Login selects/federates the upstream provider and issues the Cognito token verified by this layer.
