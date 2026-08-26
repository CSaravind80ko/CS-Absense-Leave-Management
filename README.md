# Attendance Intelligence Platform

Multi-tenant attendance and payroll preparation SaaS for importing source data, applying attendance policy, resolving exceptions, approving decisions, and producing auditable payroll exports.

## Architecture

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Web | React 19, TypeScript, Vite | Role-aware operations and employee experiences |
| API | NestJS, Prisma | Tenant-safe business APIs and attendance workflows |
| Identity | Amazon Cognito, OIDC/PKCE | Hybrid shared/dedicated authentication, MFA, and token issuance |
| Data | PostgreSQL 16 | Transactional tenant and attendance records |
| Async processing | Amazon SQS, ECS workers | Import validation and attendance calculation |
| Files | Amazon S3 | Private source imports and generated exports |
| Runtime | ECS Fargate, ALB | Containerized API |
| Delivery | S3, CloudFront | HTTPS web application and API routing |
| Infrastructure | AWS CDK, TypeScript | Repeatable dev and production environments |

Tenant authorization is not trusted from a token claim, email, or domain. A verified token's immutable issuer connection and `sub` must map through `ExternalIdentity` to an active membership for the requested `X-Tenant-Id`.

## Local development

Prerequisites: Node.js 22+, npm 10+, Docker Desktop.

```powershell
Copy-Item .env.example .env
Copy-Item apps\api\.env.example apps\api\.env
docker compose up -d
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev:api
```

Run `npm run dev:web` in a second terminal. The web application uses `VITE_API_URL` and falls back to prototype mode while the API is unavailable.

Before seeding, deploy or create the shared Cognito pool and managed-login domain. Copy its issuer, public app client ID, hosted UI base URL, and the administrator's immutable `sub` into the `SEED_IDENTITY_*` and `SEED_ADMIN_COGNITO_SUBJECT` values in `apps\api\.env`. The seed is idempotent and creates the default shared connection, tenant membership, and external identity mapping.

The web flow is:

1. Enter an organization slug or verified domain. Unknown values safely use the shared connection without disclosing whether a tenant exists.
2. Authenticate through Cognito Managed Login using OIDC Authorization Code + PKCE. Cognito owns MFA and first-login challenges.
3. Load active tenant memberships for the verified connection and immutable provider subject.
4. Select a tenant, which supplies `X-Tenant-Id` on business API requests.
5. Use role-protected employee management against PostgreSQL-backed APIs.

Browser OIDC state and tokens use `sessionStorage`, not `localStorage`. Configure `VITE_AUTH_REDIRECT_URI` and `VITE_AUTH_POST_LOGOUT_REDIRECT_URI` with exact URLs registered on the Cognito app client.

## Identity connection operations

`POST /api/v1/identity/discovery` is public and accepts:

```json
{ "organization": "example.com" }
```

It returns only `issuer`, `clientId`, `authorizationEndpoint`, `tokenEndpoint`, `endSessionEndpoint`, and `scopes`. Dedicated routing uses a normalized `IdentityConnection.discoverySlug` or entry in `verifiedDomains`; unmatched values receive the ACTIVE default `SHARED_COGNITO` connection. The response intentionally excludes tenant IDs, names, connection type, and account state.

The API decodes unverified tokens only to obtain issuer/client lookup hints. It then requires an ACTIVE exact connection, verifies RS256 against that issuer's cached JWKS, validates issuer, expiry, Cognito `token_use`, and audience/client ID, and uses only the verified `sub` as the provider identity.

Existing `TenantMembership.cognitoSubject` data has a controlled compatibility path:

1. Apply the identity-core migration and seed the shared connection.
2. Prefer an explicit bulk backfill into `ExternalIdentity`.
3. Temporarily set `ALLOW_LEGACY_COGNITO_SUBJECTS=true` to lazily create immutable mappings after a token has already passed dynamic issuer verification. Dedicated connections can migrate only their linked tenant.
4. Confirm all active memberships have mappings, set the flag back to `false`, and later remove deprecated `cognitoSubject` data in a separate migration.

New authorization must never query `cognitoSubject` directly. See `docs/identity-core.md` for contracts consumed by later SAML and SCIM layers.

## Cognito infrastructure

The shared pool has managed login, a public Authorization Code client suitable for PKCE, token revocation, TOTP, and production-required MFA/deletion protection. Synthesize with exact callback/logout arrays:

```powershell
npm run synth --workspace @attendance/infra -- --context stage=dev --context identityDomainPrefix=attendance-dev-123456789012 --context 'identityCallbackUrls=["http://localhost:5173"]' --context 'identityLogoutUrls=["http://localhost:5173"]'
```

`CognitoOidcConnection` is the reusable construct for dedicated enterprise pools. Tenant SAML onboarding does not create pools dynamically: create the pool, managed-login domain, public app client, and disabled `IdentityConnection` first. Add every dedicated pool ARN to `identityAdminPoolArns` before activation. This keeps Cognito administration resource-scoped; production IAM must never use `*`.

## Enterprise SAML onboarding

Tenant administrators configure SAML from **User & Role Management**. The lifecycle is deliberately explicit:

1. Select a pre-provisioned dedicated connection or an approved shared pool, then save an HTTPS metadata URL or XML upload.
2. Validate the entity ID, SSO endpoint, and signing certificates. XML metadata is size-limited, rejects DTDs/external entities, and is stored only in the encrypted private SAML metadata bucket. PostgreSQL retains an opaque object reference and non-sensitive fingerprints.
3. Provision the Cognito SAML identity provider and update the existing app client's supported providers. A failed app-client update compensates the provider change and leaves the configuration in `ERROR`.
4. Run the connection test. It verifies Cognito's provider and app-client configuration and returns a Managed Login test URL. The test is only configuration readiness; successful upstream authentication is confirmed after the browser completes the IdP and Cognito callback.
5. Activate the configuration. A dedicated `IdentityConnection` becomes `ACTIVE` only after AWS provisioning and test readiness. Shared-pool connections remain shared and must be listed in `SAML_SHARED_POOL_IDS`.

The API accepts metadata only over HTTPS and revalidates every redirect and resolved address to prevent SSRF. Loopback, private, link-local, carrier-grade NAT, reserved, and instance-metadata addresses are blocked. `SAML_ALLOW_INSECURE_LOCALHOST=true` is a non-production-only escape hatch for local IdP testing.

All SAML routes require a verified `TENANT_ADMIN` membership and `X-Tenant-Id`:

| Route | Purpose |
| --- | --- |
| `GET /api/v1/saml-connections` | List non-sensitive tenant configuration and status |
| `GET /api/v1/saml-connections/identity-connections` | List eligible pre-provisioned Cognito connections |
| `POST /api/v1/saml-connections` | Create or safely revise a draft |
| `PUT /api/v1/saml-connections/:id/metadata` | Fetch/upload and strictly validate metadata |
| `POST /api/v1/saml-connections/:id/provision` | Reconcile the Cognito IdP and app client |
| `POST /api/v1/saml-connections/:id/test` | Verify AWS configuration and return a Managed Login test URL |
| `POST /api/v1/saml-connections/:id/activate` | Activate routing after a successful configuration test |
| `POST /api/v1/saml-connections/:id/disable` | Remove app-client access and disable routing |

### Identity provider setup

In all providers, use the Cognito user-pool SAML service-provider values:

- **ACS / Reply URL:** `https://<managed-login-domain>/saml2/idpresponse`
- **Audience / Entity ID:** `urn:amazon:cognito:sp:<user-pool-id>`
- **Name ID:** persistent or email format backed by an immutable directory identifier where possible
- **Required claim:** map the IdP email attribute to Cognito `email`; add `given_name` and `family_name` only when the upstream directory releases them

For **Microsoft Entra ID**, create a non-gallery enterprise application, configure SAML single sign-on with the Cognito ACS and audience, assign only intended users/groups, download Federation Metadata XML, and upload it or use its HTTPS App Federation Metadata URL.

For **Okta**, create a SAML 2.0 app integration, set Single sign-on URL to the Cognito ACS, Audience URI to the Cognito entity ID, configure the email attribute statement, assign intended users/groups, and use the IdP metadata URL.

For a **generic SAML 2.0 IdP**, require signed assertions or responses, publish at least one valid X.509 signing certificate, and expose an HTTP-Redirect or HTTP-POST SSO service over HTTPS. Certificate rotation should publish overlapping current and next signing certificates before removing the old one.

SAML onboarding does not provision users or groups. SCIM belongs to Layer 3 and must consume the activated connection/configuration contracts without changing the immutable `(connectionId, providerSubject)` identity key.

### Layer 3 SCIM handoff

SCIM must consume only an `ACTIVE` `SamlConnection` and its linked `ACTIVE` `IdentityConnection`. It must preserve the connection's exact Cognito issuer/client and tenant routing, create or locate a tenant membership, and create an immutable `ExternalIdentity` keyed by `(connectionId, verified Cognito sub)`. Email, domain, SAML NameID, and custom claims are attributes, never authorization keys. `providerUsername` remains the separate Cognito administrative username. SCIM must not read raw SAML metadata, certificate material, AWS secrets, or the opaque metadata object reference, and must not reactivate a disabled SAML or identity connection.

## Tenant user and role administration

`TENANT_ADMIN` members can use the User & Role Management screen and `/api/v1/tenant-users` and `/api/v1/saml-connections` APIs to:

- invite local email/password users into the correct dedicated pool or default shared pool;
- assign application roles and tenant-scoped access;
- disable or enable both Cognito and application membership access;
- resend pending Cognito invitations and initiate password reset;
- require MFA only when the selected pool is configured with `mfaPolicy=REQUIRED`;
- view Cognito lifecycle and `SOFTWARE_TOKEN_MFA` enrollment status.

All Cognito Admin API calls run in the NestJS backend with the ECS task role. No AWS credentials, temporary passwords, TOTP setup secrets, or recovery material are returned to the browser. Each successful administrative mutation appends an `AuditEvent`. Supply additional dedicated pool ARNs through CDK `identityAdminPoolArns` context so the task role remains resource-scoped.

Disabling a user in the shared pool disables only that tenant membership when the identity still has another active tenant. Account-wide invitation resend and password reset are rejected for multi-tenant shared identities and must be performed by a platform administrator, preventing one tenant administrator from disrupting another tenant.

The shared production pool requires TOTP MFA. Development defaults to optional MFA; set `SEED_IDENTITY_MFA_POLICY` to match the deployed pool. A tenant cannot claim per-user MFA enforcement when its selected connection is optional.

## Data boundaries

All business aggregates are tenant-owned. Tenant IDs are required on employees, organization structures, source imports, attendance records, exceptions, approvals, payroll exports, and audit events. Composite unique constraints prevent identifiers from leaking or colliding across tenants.

Attendance source rows are retained separately from calculated attendance days. Processing creates traceable decisions; corrections and approvals append records rather than rewriting history. Payroll exports reference the exact period and attendance result set used to generate them.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev:web` | Start the React application |
| `npm run dev:api` | Start the NestJS API |
| `npm run build` | Build all workspaces |
| `npm run lint` | Lint web and API code |
| `npm run db:generate` | Generate the Prisma client |
| `npm run db:migrate` | Apply local database migrations |
| `npm run db:seed` | Seed the initial tenant and HR administrator |
| `npm run infra:diff` | Preview AWS changes |
| `npm run infra:deploy -- -- -c stage=dev` | Deploy the development stack |

For production, run database migrations as a one-off deployment task before shifting ECS traffic. Use separate AWS accounts for development and production, enable Cognito MFA, and retain production RDS and S3 resources.
