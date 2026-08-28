# AWS development deployment and operations

This runbook is only for the `dev` stack. The automation rejects every other
stage and never deploys production. The default region is `ap-south-1`.

## Prerequisites and account guardrails

- Node.js 22+, npm 10+, AWS CLI v2, Docker, and an AWS principal allowed to
  deploy this stack are required.
- Use a dedicated development account or a tightly controlled development
  role. `scripts/deploy-dev.mjs` calls STS and refuses to continue when the
  caller account differs from `--account`.
- GitHub Actions uses OIDC through the manually dispatched
  `.github/workflows/deploy-dev.yml`. Configure immutable
  `AWS_DEV_ACCOUNT_ID`, `AWS_DEV_REGION`, and `AWS_DEV_ROLE_ARN` variables on
  the protected `development` environment. Bind the role trust policy to this
  repository and `environment:development`; dispatchers cannot choose another
  account. Do not store long-lived AWS access keys.
- The deploy role needs CloudFormation/CDK bootstrap permissions. Runtime API
  and worker roles remain resource-scoped; do not copy deploy-role permissions
  into task roles.
- Docker must be running because CDK builds the API and worker image assets.
  CDK bootstrap is idempotent and is run automatically.

Check identity without displaying credentials:

```powershell
aws sts get-caller-identity
aws configure list
```

Never paste access keys, session tokens, Cognito passwords, bearer tokens, or
presigned URLs into commands, source files, CI logs, issues, or pull requests.

## Build, synth, diff, and deploy

Every command requires an explicit account. Additional custom web origins must
be HTTPS. The generated CloudFront URL is automatically registered as a
Cognito callback/logout URL and as an import-bucket PUT origin.

```powershell
$account = '123456789012'
$region = 'ap-south-1'

npm ci
node scripts/deploy-dev.mjs --action synth --stage dev --account $account --region $region
node scripts/deploy-dev.mjs --action diff --stage dev --account $account --region $region
node scripts/deploy-dev.mjs --stage dev --account $account --region $region
```

For a custom HTTPS domain already routed to the distribution:

```powershell
node scripts/deploy-dev.mjs --stage dev --account $account --region $region `
  --callback-url https://attendance-dev.example.com `
  --logout-url https://attendance-dev.example.com
```

Deployment builds web/API/worker assets, bootstraps CDK, deploys API and worker
at desired count zero, starts the migration task in an isolated
subnets, waits for `prisma migrate deploy`, then enables both services. A
migration failure leaves traffic disabled and exits nonzero. CDK output files
are written to an OS temporary directory and removed.

The final health check is
`https://<distribution>/api/v1/health`. Frontend defaults deliberately use
`window.location.origin` and `/api/v1`, so CloudFront, Cognito redirect/logout,
API routing, and same-origin browser requests agree without embedding a
deployment URL in the JavaScript bundle.

## Migration and migration recovery

The `MigrationTaskDefinitionArn`, `MigrationContainerName`, `ClusterName`,
`PrivateSubnetIds`, `MigrationSecurityGroupId`, and `MigrationLogGroupName`
outputs support repeatable one-off execution. The task uses the same immutable
API image and database secret as the API, has no public IP, and runs in an
isolated subnet. Its security group permits PostgreSQL plus private ECR, S3,
Secrets Manager, and CloudWatch Logs endpoints; it has no internet egress.

Normal deployments run all pending migrations automatically. To recover a
failure:

1. Read only the migration task's CloudWatch log stream. Do not print the
   database secret or task environment.
2. Correct the migration or infrastructure issue and rerun the whole deploy.
   `prisma migrate deploy` is idempotent for already applied migrations.
3. Confirm `20260828150000_attendance_ingestion_workers` is applied before
   allowing API or worker desired counts above zero.
4. Never mark a failed migration applied unless the database schema was
   independently reconciled and reviewed.

RDS is private, encrypted, and reachable only from API, worker, and migration
task security groups. Do not add a public route or public accessibility for
migration convenience.

## Development seed and Cognito bootstrap

Seeding is opt-in and is not part of every deploy. First create a development
Cognito administrator through an approved operator flow, complete the initial
password/MFA challenge, and record the immutable Cognito `sub`. Do not
hard-code or automate a Cognito password.

Run the API seed only after supplying:

- `SEED_TENANT_NAME`, `SEED_TENANT_SLUG`
- `SEED_ADMIN_COGNITO_SUBJECT`, `SEED_ADMIN_EMAIL`
- `SEED_IDENTITY_ISSUER`, `SEED_IDENTITY_CLIENT_ID`
- `SEED_IDENTITY_HOSTED_UI_DOMAIN`
- optionally `SEED_ATTENDANCE_DEMO=true`

Use a one-off override of the migration task command:
`node_modules/.bin/prisma db seed --schema apps/api/prisma/schema.prisma`.
Supply the non-secret seed values as task environment overrides, use the same
private subnet/security-group outputs as migration, wait for exit code zero,
then remove any local shell values. The seed is idempotent and its sample
tenant/data is clearly marked as development. The attendance fixture uses
`DEMO-1001`, matching the development seed.

Manual login remains necessary to obtain an interactive Cognito authorization
code and establish the browser session. No test depends on a customer IdP.

## End-to-end validation

The credential-free deterministic fallback runs real API/worker unit
integration boundaries plus synthesized CloudFormation assertions:

```powershell
npm run e2e:local
```

It verifies upload signing and ownership metadata, cross-tenant denial,
transactional file-ready/outbox behavior, malformed/row-limit/formula handling,
event schema enforcement, EventLedger retry/acknowledgement behavior, payroll
formula safety, migration-first desired counts, private/encrypted/versioned
storage, FIFO/DLQ configuration, private RDS, migration task wiring, alarms,
dashboard, HTTPS redirect, and absence of wildcard IAM actions.

Against a deployed stack, first run infrastructure-only checks:

```powershell
node scripts/e2e-dev.mjs --stage dev --account $account --region $region
```

This verifies S3 public access block, default encryption, versioning, deployed
origin CORS, FIFO/redrive/20-minute visibility, ECS private networking, alarms,
dashboard, API/database health, CloudFront web loading, and a temporary
isolated queue's five-receive DLQ behavior. Temporary queues are deleted in a
`finally` cleanup path.

For the complete browser-upload/API/worker/payroll path, provision an isolated
development tenant with an active `DEMO-1001`, `HQ`, and an OPEN August 2026
period. Keep the token in an environment variable, never an argument:

```powershell
$env:E2E_BEARER_TOKEN = '<short-lived token>'
$env:E2E_TENANT_ID = '<isolated dev tenant UUID>'
$env:E2E_PERIOD_ID = '<isolated OPEN period UUID>'
node scripts/e2e-dev.mjs --stage dev --account $account --region $region --authenticated
Remove-Item Env:E2E_BEARER_TOKEN
```

The harness creates the import job, reserves the presign, sends every signed
header including the base64 checksum and ownership metadata, performs direct
PUT, finalizes, polls, validates retained rows/punch counts, replays the exact
event ID, and proves results are unchanged. It also checks malformed,
oversized, formula, foreign-tenant, and stale-period cases; generates and
downloads a short-lived private payroll export; and confirms direct public
object URLs are denied.

The optional period race temporarily sets the isolated dev worker service to
zero, requests an export, reopens the period, restores scaling in `finally`,
and requires `FAILED/PERIOD_VERSION_STALE` with no download:

```powershell
node scripts/e2e-dev.mjs --stage dev --account $account --region $region `
  --authenticated --period-race
```

Use only an isolated tenant for authenticated E2E. The public API intentionally
has no destructive fixture endpoint, so database fixture rows remain until the
dev stack is torn down or an approved private cleanup task removes records by
the logged correlation ID.

## Monitoring and alarms

The stack dashboard covers API target health/5xx, API and worker CPU/memory,
queue depth/age, DLQ depth, and RDS CPU/connections/free storage. ECS Container
Insights and one-week structured API/worker/migration log groups are enabled.
Use the event ID as the worker correlation ID; logs must not contain raw
attendance rows, JWTs, presigned URLs, or secrets.

Investigate alarms in this order:

1. DLQ depth and oldest message age.
2. Worker desired/running count, deployment/circuit-breaker events, CPU, and
   memory.
3. RDS connectivity, connections, free storage, and CPU.
4. S3/SQS/KMS authorization failures using CloudTrail request IDs.
5. API unhealthy targets and 5xx responses.

## DLQ replay

1. Capture the event ID/type/tenant ID from sanitized logs and correct the
   cause.
2. Confirm the job is retryable. A completed EventLedger record is an
   intentional no-op.
3. Use SQS redrive from the stack DLQ to its source queue, preserving the body,
   group, and event ID. Do not edit ledger rows.
4. Monitor receive count, queue age, worker logs, job state, and audit state.
5. Stop redrive if failures recur. After five receives the message returns to
   the DLQ; failed messages are never acknowledged by the worker.

## Rollback and incident response

- ECS deployment circuit breakers roll back unhealthy task revisions.
- If migration fails, services remain at zero. Fix forward; do not restore an
  application revision whose schema requirements exceed the database.
- For an application-only regression after a successful migration, deploy the
  last known-good commit if it is schema-compatible.
- For compromised credentials, revoke the principal/session, rotate the
  affected secret, inspect CloudTrail, and redeploy. Never place credentials in
  a CloudFormation parameter or output.
- Keep buckets and RDS private during incidents. Use task roles and audited
  one-off tasks rather than public access.

## Cost controls and teardown

Development uses one NAT gateway, one small single-AZ RDS instance, one API
task, one worker task, bounded worker autoscaling, and four single-AZ migration
interface endpoints. S3 lifecycle expiration removes imports and exports after
30 days. CloudWatch logs expire after one week. Stop or tear down idle
development environments promptly; RDS, NAT gateway, ALB, interface endpoints,
and Fargate are the primary hourly costs.

Teardown requires an explicit confirmation:

```powershell
node scripts/deploy-dev.mjs --action destroy --confirm-destroy dev `
  --stage dev --account $account --region $region
```

Dev buckets auto-delete objects and dev resources use destroy policies. Before
teardown, retain any audit evidence required by policy. Production resources
use retention/deletion protection and are outside this automation.
