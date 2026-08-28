# Attendance ingestion and payroll workers (Layer 2)

Layer 2 adds private direct-to-S3 attendance uploads, a transactional PostgreSQL outbox, FIFO SQS delivery, idempotent ECS workers, attendance recomputation, and asynchronous payroll files. It preserves the identity and tenant-membership contracts documented in [identity-core.md](identity-core.md) and [scim-provisioning.md](scim-provisioning.md).

## Upload API

All endpoints require an authenticated active tenant membership and `X-Tenant-Id`. Import mutations require `TENANT_ADMIN` or `HR_ADMIN`.

1. `POST /api/v1/attendance/imports` reserves a `PENDING` job and atomically enqueues `attendance.import.requested.v1`.
2. `POST /api/v1/attendance/imports/:id/uploads` accepts `fileName`, exact `contentType`, `sizeBytes`, and a lowercase hexadecimal SHA-256. It returns a five-minute presigned PUT.
3. The browser PUTs directly to the returned private tenant/job-derived key with the returned checksum header. The API never proxies the file.
4. `POST /api/v1/attendance/imports/:id/uploads/:uploadId/finalize` HEAD-validates the object size, content type, SHA-256, and tenant/job/upload metadata. A serializable transaction consumes the reservation once, creates `AttendanceImportFile`, and enqueues `attendance.import.file-ready.v1`.
5. `GET /api/v1/attendance/imports/:id` returns retained file metadata, row-status counts, progress counters, and actionable `errorCode`.

Only `.csv` (`text/csv`) and `.xlsx` (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`) are accepted. The default file limit is 25 MiB. Upload and download URLs expire after five minutes. Buckets block public access and use KMS encryption.

## Attendance template and limits

The first row must contain these case-sensitive headers:

| Header | Required | Format |
| --- | --- | --- |
| `employeeNumber` | Yes | Existing employee number in the selected tenant |
| `occurredAt` | Yes | RFC 3339 with offset, or `yyyy-MM-dd HH:mm[:ss]` in the tenant timezone |
| `punchType` | Yes | `IN`, `OUT`, `BREAK_START`, or `BREAK_END` |
| `externalId` | No | Source-stable punch identifier; a deterministic file/row ID is used when omitted |
| `locationCode` | No | Existing location code in the tenant |
| `source` | No | Source name, defaulting to the job source |

Defaults are 50,000 rows, 20 columns, 1 KiB per cell, 200 MiB total XLSX uncompressed size, 2,048 archive entries, and a 100:1 compression ratio. CSV must be UTF-8. XLSX must contain one unencrypted worksheet. Formula cells are rejected and formulas are never evaluated. The representative fixture is `fixtures/attendance-import.csv`.

Rows are validated without logging raw row data. Retained row data is limited to the canonical allowlisted fields. Tenant-owned employee, period, and location references are rechecked by the worker. Unknown/inactive employees, out-of-period records, duplicate punches, and invalid punch sequences create deterministic exceptions where applicable. Retries use stable row, punch, attendance-day, export-item, and exception keys; existing manual exception decisions are not overwritten.

## Events and outbox

`apps/contracts/src/events.ts` is the source of truth for:

- `attendance.import.requested.v1`
- `attendance.import.file-ready.v1`
- `attendance.import.completed.v1`
- `payroll.export.requested.v1`
- `payroll.export.completed.v1`

Every event has `schemaVersion: 1`, a UUID `eventId`, exact `eventType`, RFC 3339 `occurredAt`, and tenant-scoped payload fields from [live-attendance-workflows.md](live-attendance-workflows.md). Consumers reject unknown schema versions/types. SQS group and deduplication IDs include the tenant ID. `OutboxEvent` is written in the same transaction as each state mutation; the worker dispatcher leases rows with `FOR UPDATE SKIP LOCKED`, retries with exponential backoff, and marks them published only after SQS accepts the message.

`EventLedger` leases each event ID. Completed duplicates are acknowledged without reprocessing. Failed messages are not deleted, visibility is extended during long jobs, and SQS moves them to the DLQ after five receives.

## Payroll export

`POST /api/v1/payroll/exports` atomically reserves and enqueues a versioned request. At execution and immediately before commit, the worker requires the period to remain `APPROVED` at the requested version and have no critical/BLOCKED exceptions. It generates CSV or XLSX with spreadsheet-formula-safe text cells, uploads to the private export bucket with SHA-256, writes employee items, marks the export `READY`, audits the transition, and enqueues completion in one transaction. `GET /api/v1/payroll/exports/:id/download` returns a short-lived URL only for a tenant-owned ready export whose period version is still current.

## Local development

```powershell
docker compose up -d postgres localstack
$env:DATABASE_URL='postgresql://attendance:attendance@localhost:5432/attendance?schema=public'
npm.cmd run db:generate
npm.cmd run db:migrate
docker compose --profile workers up --build worker
```

Run the API with the S3/SQS variables from `apps/api/.env.example`. Seed a period, employee `EMP-0001`, and location `HQ`, then upload `fixtures/attendance-import.csv` through Data Import Centre. LocalStack creates the private buckets and FIFO queue/DLQ automatically.

## Retry, DLQ, and replay

Transient database, S3, or SQS failures leave the message unacknowledged for retry. Permanent template, ownership, lifecycle, or version failures update the job/export to `FAILED`, append the documented audit action, and publish a failed completion event. Do not manually change ledger or job states to replay.

To replay a DLQ item:

1. Identify the correlation `eventId` in structured worker logs and correct the operational cause.
2. Confirm the database job remains retryable; a completed ledger entry is intentionally a no-op.
3. Use SQS DLQ redrive to the source FIFO queue. Preserve the original JSON body, message group, and event ID.
4. Monitor queue age, the DLQ alarm, job progress, and the matching audit actions.

For a deliberate re-import after a permanent failure, create a new import job and upload reservation. For a period-version payroll failure, resolve blockers or re-approve the period and create a new export request.

## Deployment boundary for Layer 3

Layer 3 must apply migration `20260828150000_attendance_ingestion_workers`, deploy the CDK stack, configure API/worker database credentials and object/queue variables, verify bucket CORS against the final web origin, and exercise browser upload through completion and payroll download. It must validate queue depth scaling, visibility extension, DLQ redrive, structured correlation IDs, KMS access, private object policies, and alarms. Layer 2 does not deploy resources.
