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

`CognitoOidcConnection` is the reusable construct for future dedicated enterprise pools. This layer does not instantiate tenant-specific pools or implement SAML/SCIM.

## Tenant user and role administration

`TENANT_ADMIN` members can use the User & Role Management screen and `/api/v1/tenant-users` APIs to:

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
