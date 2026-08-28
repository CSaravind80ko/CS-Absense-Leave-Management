# Live attendance workflows (Layer 1)

Layer 1 replaces the operational attendance mocks with tenant-scoped PostgreSQL APIs and typed React clients. It deliberately stops at durable job metadata. It does not create presigned uploads, read CSV/XLSX files, publish to SQS, or generate export files.

## HTTP surface

Every route below requires a verified identity, active tenant membership, and `X-Tenant-Id`. Entity lookups always include the tenant ID.

| Route | Roles | Purpose |
| --- | --- | --- |
| `GET /api/v1/attendance/periods` | tenant admin, HR, manager, payroll, auditor | Paginated/filterable processing periods |
| `POST /api/v1/attendance/periods` | tenant admin, HR | Create a non-overlapping period |
| `GET /api/v1/attendance/periods/:id` | tenant admin, HR, manager, payroll, auditor | Period detail and record counts |
| `PATCH /api/v1/attendance/periods/:id/status` | tenant admin, HR | Versioned lifecycle transition or reasoned reopen |
| `GET /api/v1/attendance/register` | tenant admin, HR, manager, payroll, auditor | Paginated daily attendance register |
| `GET /api/v1/attendance/days/:id` | tenant admin, HR, manager, payroll, auditor | Day, employee, exception, and punch-source detail |
| `GET /api/v1/attendance/dashboard` | tenant admin, HR, manager, payroll, auditor | Period-specific live readiness metrics |
| `GET /api/v1/attendance/imports` | tenant admin, HR, manager, payroll, auditor | Import metadata and worker status |
| `POST /api/v1/attendance/imports` | tenant admin, HR | Reserve an import job; no upload is implied |
| `GET /api/v1/exceptions` | tenant admin, HR, manager, payroll, auditor | Filterable exception queue and summary |
| `GET /api/v1/exceptions/:id` | tenant admin, HR, manager, payroll, auditor | Exception evidence, target day, and approval history |
| `PATCH /api/v1/exceptions/:id/assignment` | tenant admin, HR, manager | Versioned assignment |
| `PATCH /api/v1/exceptions/:id/decision` | tenant admin, HR, manager | Versioned resolution/dismissal with mandatory reason |
| `GET /api/v1/approvals` | tenant admin, HR, manager, payroll, auditor | Inbox/requested/all scopes with append-only action history |
| `GET /api/v1/approvals/:id` | tenant admin, HR, manager, payroll, auditor | Approval target and history detail |
| `POST /api/v1/approvals` | tenant admin, HR, manager, payroll | Submit an approval request |
| `POST /api/v1/approvals/:id/actions` | tenant admin, HR, manager, payroll | Versioned approve/reject/comment/cancel action |
| `GET /api/v1/payroll/register` | tenant admin, HR, payroll, auditor | Employee totals and critical-blocker readiness |
| `GET /api/v1/payroll/exports` | tenant admin, HR, payroll, auditor | Export requests and worker status |
| `GET /api/v1/payroll/exports/:id` | tenant admin, HR, payroll, auditor | Export request, approval, and generated items |
| `POST /api/v1/payroll/exports` | tenant admin, HR, payroll | Reserve a metadata-only export request |

List routes accept `page`, `pageSize` (maximum 100), `order`, and route-specific filters. Mutable workflow records expose `version`. Clients must send the version on period transitions, exception assignment/decision, approval action, and payroll export reservation. A stale write returns HTTP `409`.

## Lifecycle and blocker rules

The forward period lifecycle is `OPEN -> PROCESSING -> REVIEW -> APPROVED -> EXPORTED -> CLOSED`. Supported reopens are `PROCESSING -> OPEN`, `REVIEW -> PROCESSING`, `APPROVED -> REVIEW`, and `EXPORTED -> REVIEW`; each requires a reason and writes an `AuditEvent`.

`APPROVED` and `EXPORTED` transitions, and payroll export reservation, fail while an open exception has `severity=CRITICAL` or `payrollImpact=BLOCKED`. Marking a period `EXPORTED` additionally requires a `READY` payroll export generated for the period's current `version`, so reopening a period automatically makes earlier exports ineligible without destroying their audit history.

## Layer 2 worker contracts

All messages are UTF-8 JSON. Consumers must reject unknown `schemaVersion`, use `(tenantId, entityId)` for every lookup, and be idempotent. SQS message-group and deduplication keys must include the tenant ID.

### Job reservation

`POST /attendance/imports` returns, but does not publish:

```json
{
  "job": { "id": "uuid", "status": "PENDING" },
  "workerConnected": false,
  "dispatch": {
    "eventType": "attendance.import.requested.v1",
    "payload": {
      "tenantId": "uuid",
      "periodId": "uuid",
      "importJobId": "uuid",
      "source": "MANUAL_FILE",
      "requestedBy": "verified-sub",
      "requestedAt": "RFC3339"
    }
  }
}
```

Layer 2 owns the upload completion transaction that creates `AttendanceImportFile` and publishes `attendance.import.file-ready.v1`:

```json
{
  "schemaVersion": 1,
  "eventId": "uuid",
  "eventType": "attendance.import.file-ready.v1",
  "occurredAt": "RFC3339",
  "tenantId": "uuid",
  "periodId": "uuid",
  "importJobId": "uuid",
  "importFileId": "uuid",
  "source": "MANUAL_FILE",
  "object": {
    "bucket": "private-bucket-name",
    "key": "tenant/uuid/imports/uuid/source.csv",
    "contentType": "text/csv",
    "sizeBytes": "12345",
    "checksumSha256": "lowercase-hex"
  }
}
```

The ingestion worker atomically claims only `PENDING` jobs, sets `PROCESSING`, validates the tenant/period/file composite references, writes retained rows and punches idempotently, updates attendance days/exceptions, then sets `COMPLETED` or `FAILED`. It publishes `attendance.import.completed.v1` with:

```json
{
  "schemaVersion": 1,
  "eventId": "uuid",
  "eventType": "attendance.import.completed.v1",
  "occurredAt": "RFC3339",
  "tenantId": "uuid",
  "periodId": "uuid",
  "importJobId": "uuid",
  "status": "COMPLETED",
  "acceptedRows": 3642,
  "rejectedRows": 13,
  "punchesUpserted": 3642,
  "attendanceDaysUpdated": 168,
  "exceptionsOpened": 17,
  "errorCode": null
}
```

### Payroll generation

`POST /payroll/exports` returns, but does not publish, `payroll.export.requested.v1` with `tenantId`, `periodId`, `periodVersion`, `payrollExportId`, `format`, `requestedBy`, and `requestedAt`.

Layer 2 atomically claims a `DRAFT` export at its current `version`, sets `GENERATING`, confirms the period is still `APPROVED` at the requested version and still has no critical blockers, writes one `PayrollExportItem` per employee, writes the private object, then sets `READY` with `storageKey`, `checksum`, and `generatedAt`. It publishes:

```json
{
  "schemaVersion": 1,
  "eventId": "uuid",
  "eventType": "payroll.export.completed.v1",
  "occurredAt": "RFC3339",
  "tenantId": "uuid",
  "periodId": "uuid",
  "periodVersion": 7,
  "payrollExportId": "uuid",
  "status": "READY",
  "itemCount": 168,
  "object": {
    "bucket": "private-bucket-name",
    "key": "tenant/uuid/payroll/uuid/register.xlsx",
    "checksumSha256": "lowercase-hex"
  },
  "errorCode": null
}
```

Workers write audit actions `attendance.import.processing`, `attendance.import.completed`/`failed`, and `payroll.export.generating`, `payroll.export.ready`/`failed` in the same database transaction as each state change.
