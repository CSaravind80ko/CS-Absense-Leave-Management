# Policy and calculation engine

This layer replaces the previously hardcoded, policy-blind attendance calculation with effective-dated, scoped policy versions and a worker calculation that evaluates them. It builds on the ingestion pipeline in [attendance-ingestion-workers.md](attendance-ingestion-workers.md) and the tenant/data-boundary contracts in [live-attendance-workflows.md](live-attendance-workflows.md); nothing about import ingestion, punch persistence, or the outbox mechanism changes.

## Data model

`PolicyVersion` rows are immutable and effective-dated. Each is scoped to exactly one of `TENANT`, `LOCATION`, `DEPARTMENT`, `EMPLOYEE_GROUP`, or `EMPLOYEE` (`scopeId` is always populated, even for `TENANT` scope, where it equals the tenant ID). A version's lifecycle is `DRAFT → PUBLISHED`; publishing is append-only — a version can only supersede an earlier `PUBLISHED` version for the same scope with a strictly later `effectiveFrom`. Published versions are never edited or deleted.

`EmployeeGroup`/`EmployeeGroupMember` provide `EMPLOYEE_GROUP` scoping. A group's `priority` (higher wins) breaks ties when an employee belongs to more than one group with an applicable policy; an equal-priority tie breaks by ascending group ID.

`Holiday` rows mark non-working dates, optionally location-scoped (`locationId: null` is tenant-wide; a location-specific row for the same date takes priority). `PolicyRecomputeJob` tracks an async, selective attendance-day reprocessing run, structurally identical to `AttendanceImportJob` so the worker's existing claim/complete/fail conventions apply unchanged.

Every migration backfills a `PUBLISHED` `TENANT`-scope default `PolicyVersion` for existing tenants, so precedence resolution always has a fallback — see "Precedence resolution" below.

## Precedence resolution

For a given `(tenant, employee, date)`, precedence is **whole-record**, not field-level: exactly one `PolicyVersion` applies in full, chosen as the most specific scope with a `PUBLISHED` version whose `effectiveFrom` has passed, in order:

```
EMPLOYEE > EMPLOYEE_GROUP (priority desc, id asc) > DEPARTMENT > LOCATION > TENANT
```

The algorithm is implemented independently in `apps/api/src/policies/policy-resolution.ts` and `apps/worker/src/policy-resolution.ts` (no shared business-logic package exists between the two apps today, only `@attendance/contracts` for event schemas) — both files cross-reference each other, and their test suites (`policies.service.spec.ts`, `policy-resolution.spec.ts`) assert the same precedence/tie-break behavior to guard against drift. If even the `TENANT` scope has no match, resolution throws a data-integrity error rather than silently computing with no policy — this should be unreachable given the backfill and the tenant-scope invariant.

## Rule fields

A `PolicyVersion.rules` JSON blob (validated by nested `class-validator` DTOs on the API) carries:

| Field | Meaning |
| --- | --- |
| `lateArrival.graceMinutes` | Minutes after scheduled start before a punch counts as late |
| `earlyDeparture.graceMinutes` | Minutes before scheduled end a punch can occur without counting as early |
| `overtime.thresholdMinutes` | Minutes worked beyond schedule required before overtime accrues |
| `overtime.dailyCapMinutes` | Maximum overtime minutes per day (`null` = uncapped) |
| `overtime.roundingMinutes` | Overtime is rounded down to the nearest multiple of this |
| `halfDay.halfDayThresholdMinutes` | Worked minutes below this, on a `PARTIAL` day, opens a half-day LOP exception |
| `absence.lop` | Whether ABSENCE exceptions carry `payrollImpact: UNPAID_MINUTES` (vs. `REVIEW_REQUIRED`) |

`PolicyVersion.workingWeekdays` (ISO weekday, 1=Mon..7=Sun) determines calendar weekends independently of the rules blob.

## Worker calculation

`recomputeDay` (`apps/worker/src/processor.ts`) resolves the effective policy and calendar day type for each `(employee, workDate)`, then:

- **Holiday/Weekend**: a matching `Holiday` row, or a weekday absent from `workingWeekdays`, sets `status` to `HOLIDAY`/`WEEKEND` and `scheduledMinutes: 0`; any worked time on such a day is recorded entirely as overtime (comp-off handling is a later roadmap item, not this one).
- **Working day**: `scheduledMinutes`/`ABSENT`/`PARTIAL`/`PRESENT` thresholds are unchanged from the pre-policy implementation. `lateMinutes` and early-departure minutes are computed against the shift's scheduled start/end plus grace; overtime applies threshold, rounding, and cap; a full or half-day-threshold-crossing `PARTIAL`/`ABSENT` day opens an LOP-relevant `ABSENCE` exception.

A structured `calculationTrace` (policy version/scope used, day type, holiday, the rules applied, and a per-rule evaluation list) is stored on `AttendanceDay.calculationTrace`, alongside `policyVersionId` — this is the basis for a future rule-explanation UI.

New exception types reuse the exact `dedupeKey` + `createMany({ skipDuplicates: true })` mechanism already used for `MISSING_PUNCH`/`DUPLICATE_PUNCH`: a duplicate `dedupeKey` silently no-ops without reading the existing row, so a recompute can never reopen or overwrite an exception a human has already resolved or dismissed.

| Type | dedupeKey | Trigger |
| --- | --- | --- |
| `MISSING_PUNCH` | `day:{id}:missing-punch` | Incomplete IN/OUT pair, gated to `WORKING` days only |
| `DUPLICATE_PUNCH` | `day:{id}:invalid-sequence` | Out-of-order punches (unchanged, ungated) |
| `LATE_ARRIVAL` | `day:{id}:late-arrival` | `WORKING` day, late beyond grace |
| `EARLY_DEPARTURE` | `day:{id}:early-departure` | `WORKING` day, left beyond grace before scheduled end |
| `OVERTIME` | `day:{id}:overtime` | Any day, overtime minutes > 0 |
| `ABSENCE` | `day:{id}:absence` | `WORKING` day, full (`ABSENT`) or half-day-threshold (`PARTIAL`) LOP |

A recompute never auto-closes an exception that no longer applies after a policy change (for example, a widened grace period) — this matches the pre-existing behavior of `MISSING_PUNCH`/`DUPLICATE_PUNCH` and is a deliberate, unchanged limitation, not a new one.

## Selective reprocessing

Publishing a policy version, or changing employee-group membership/priority, enqueues `attendance.day.recompute-requested.v1` (added to `apps/contracts/src/events.ts` alongside `.completed.v1`) through the existing outbox/SQS pipeline — no new infrastructure. The event carries a scope and date range; the worker resolves matching `AttendanceDay` rows (cursor-paginated in batches of 200, each batch its own `Serializable` transaction) and re-runs `recomputeDay` for each. `EventLedger` idempotency and SQS retry/DLQ behavior apply automatically, as with every other event type.

Publishing a policy version scopes the recompute to `[effectiveFrom, today]` and is rejected (`400`) if that range exceeds `POLICY_MAX_RECOMPUTE_DAYS` (default 400) — publish with a more recent `effectiveFrom` instead. A single membership/priority change scopes the recompute to the last `POLICY_RECOMPUTE_MEMBERSHIP_LOOKBACK_DAYS` days (default 60), since group membership has no effective-dating in this slice.

## API

All routes require `X-Tenant-Id` and an active membership; mutations require `TENANT_ADMIN` or `HR_ADMIN` (the same role set as `AttendanceModule`, since this is attendance-config plane, not identity plane).

| Route | Purpose |
| --- | --- |
| `GET /api/v1/policies` | Paginated list, filterable by scope/status |
| `GET /api/v1/policies/effective` | Today's effective version per distinct scope |
| `GET /api/v1/policies/:id` | Fetch one version |
| `POST /api/v1/policies` | Create a `DRAFT` |
| `PUT /api/v1/policies/:id` | Update a `DRAFT` (optimistic-concurrency `version`) |
| `DELETE /api/v1/policies/:id` | Delete a `DRAFT` |
| `POST /api/v1/policies/:id/publish` | Publish, enqueueing the scoped recompute |
| `POST /api/v1/policies/resolve` | Resolve the effective policy for an employee/date, with the evaluated scope chain |
| `GET/POST/PUT /api/v1/employee-groups` | Group CRUD |
| `POST/DELETE /api/v1/employee-groups/:id/members[/:employeeId]` | Membership changes |

`publish` mirrors `SamlConnectionsService.activate()`'s compare-and-swap lifecycle: reload, precondition checks, a guarded `updateMany`, a paired `AuditEvent`, all in one transaction with the recompute-job creation and outbox enqueue.

## Rollout sequencing

1. Rebuild `@attendance/contracts` (new event types plus a `parseAttendanceEvent` fix: `periodId` is now required only for `attendance.import.*`/`payroll.export.*` events, not generically — the recompute events have no natural `periodId`).
2. Deploy the worker. From this point, the *existing* import path immediately starts producing policy-aware output (HOLIDAY/WEEKEND statuses, `lateMinutes`, the new exception types) — this is an intentional bundled behavior change, not a bug.
3. Apply the database migration (the tenant-default backfill runs as part of it — no separate script to sequence).
4. Deploy the API. Only from here does anything actually enqueue `attendance.day.recompute-requested.v1`.

Set `SEED_POLICY_ENGINE_DEMO=true` for local evaluation only — it seeds a demo employee group with an overriding policy and a demo holiday, following the same disabled-by-default convention as `SEED_ATTENDANCE_DEMO`.

## Scope of this layer

This is the calculation engine only. The no-code policy editor UI, publish preview/impact comparison, and the attendance-day explanation drawer (reading `calculationTrace`) are follow-up work against the API surface documented here.
