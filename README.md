# Attendance Intelligence Platform

Multi-tenant attendance and payroll preparation SaaS for importing source data, applying attendance policy, resolving exceptions, approving decisions, and producing auditable payroll exports.

## Architecture

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Web | React 19, TypeScript, Vite | Role-aware operations and employee experiences |
| API | NestJS, Prisma | Tenant-safe business APIs and attendance workflows |
| Identity | Amazon Cognito | Authentication, MFA, and token issuance |
| Data | PostgreSQL 16 | Transactional tenant and attendance records |
| Async processing | Amazon SQS, ECS workers | Import validation and attendance calculation |
| Files | Amazon S3 | Private source imports and generated exports |
| Runtime | ECS Fargate, ALB | Containerized API |
| Delivery | S3, CloudFront | HTTPS web application and API routing |
| Infrastructure | AWS CDK, TypeScript | Repeatable dev and production environments |

Tenant authorization is not trusted from a token claim alone. Every authenticated Cognito subject must have an active database membership for the requested `X-Tenant-Id`.

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

Before seeding, create the first HR administrator in Cognito and copy the user's immutable `sub` value into `SEED_ADMIN_COGNITO_SUBJECT` in `apps\api\.env`. Configure the same user pool and client in the root `.env`. The seed is idempotent and creates the tenant membership used by the authenticated `GET /api/v1/me/tenants` request.

The web flow is:

1. Authenticate with Cognito.
2. Load active tenant memberships for the authenticated subject.
3. Select a tenant, which supplies `X-Tenant-Id` on business API requests.
4. Use role-protected employee management against PostgreSQL-backed APIs.

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
