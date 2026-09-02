export const EVENT_TYPES = [
  'attendance.import.requested.v1',
  'attendance.import.file-ready.v1',
  'attendance.import.completed.v1',
  'payroll.export.requested.v1',
  'payroll.export.completed.v1',
  'attendance.day.recompute-requested.v1',
  'attendance.day.recompute-completed.v1',
] as const;

export const POLICY_SCOPE_TYPES = [
  'TENANT',
  'LOCATION',
  'DEPARTMENT',
  'EMPLOYEE_GROUP',
  'EMPLOYEE',
] as const;

export type PolicyScopeType = (typeof POLICY_SCOPE_TYPES)[number];

export type AttendanceEventType = (typeof EVENT_TYPES)[number];

interface EventEnvelope {
  schemaVersion: 1;
  eventId: string;
  eventType: AttendanceEventType;
  occurredAt: string;
  tenantId: string;
}

export interface AttendanceImportRequestedEvent extends EventEnvelope {
  eventType: 'attendance.import.requested.v1';
  periodId: string;
  importJobId: string;
  source: string;
  requestedBy: string;
  requestedAt: string;
}

export interface AttendanceImportFileReadyEvent extends EventEnvelope {
  eventType: 'attendance.import.file-ready.v1';
  periodId: string;
  importJobId: string;
  importFileId: string;
  source: string;
  object: {
    bucket: string;
    key: string;
    contentType: string;
    sizeBytes: string;
    checksumSha256: string;
  };
}

export interface AttendanceImportCompletedEvent extends EventEnvelope {
  eventType: 'attendance.import.completed.v1';
  periodId: string;
  importJobId: string;
  status: 'COMPLETED' | 'FAILED';
  acceptedRows: number;
  rejectedRows: number;
  punchesUpserted: number;
  attendanceDaysUpdated: number;
  exceptionsOpened: number;
  errorCode: string | null;
}

export interface PayrollExportRequestedEvent extends EventEnvelope {
  eventType: 'payroll.export.requested.v1';
  periodId: string;
  periodVersion: number;
  payrollExportId: string;
  format: 'CSV' | 'XLSX';
  requestedBy: string;
  requestedAt: string;
}

export interface PayrollExportCompletedEvent extends EventEnvelope {
  eventType: 'payroll.export.completed.v1';
  periodId: string;
  periodVersion: number;
  payrollExportId: string;
  status: 'READY' | 'FAILED';
  itemCount: number;
  object: {
    bucket: string;
    key: string;
    checksumSha256: string;
  } | null;
  errorCode: string | null;
}

export interface AttendanceDayRecomputeRequestedEvent extends EventEnvelope {
  eventType: 'attendance.day.recompute-requested.v1';
  recomputeJobId: string;
  scopeType: PolicyScopeType;
  scopeId: string;
  dateFrom: string;
  dateTo: string;
  requestedBy: string;
  requestedAt: string;
}

export interface AttendanceDayRecomputeCompletedEvent extends EventEnvelope {
  eventType: 'attendance.day.recompute-completed.v1';
  recomputeJobId: string;
  status: 'COMPLETED' | 'FAILED';
  daysMatched: number;
  daysRecomputed: number;
  exceptionsOpened: number;
  errorCode: string | null;
}

export type AttendanceEvent =
  | AttendanceImportRequestedEvent
  | AttendanceImportFileReadyEvent
  | AttendanceImportCompletedEvent
  | PayrollExportRequestedEvent
  | PayrollExportCompletedEvent
  | AttendanceDayRecomputeRequestedEvent
  | AttendanceDayRecomputeCompletedEvent;

type EventPayload<T extends AttendanceEvent> = Omit<
  T,
  'schemaVersion' | 'eventId' | 'eventType' | 'occurredAt'
>;

export function createEvent<T extends AttendanceEvent>(
  eventType: T['eventType'],
  payload: EventPayload<T>,
  eventId = crypto.randomUUID(),
  occurredAt = new Date().toISOString(),
): T {
  return {
    schemaVersion: 1,
    eventId,
    eventType,
    occurredAt,
    ...payload,
  } as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string): void {
  if (typeof record[key] !== 'string' || record[key] === '') {
    throw new Error(`Invalid event field: ${key}`);
  }
}

function requireNumber(record: Record<string, unknown>, key: string): void {
  if (typeof record[key] !== 'number' || !Number.isFinite(record[key])) {
    throw new Error(`Invalid event field: ${key}`);
  }
}

function requireNullableString(
  record: Record<string, unknown>,
  key: string,
): void {
  if (record[key] !== null && typeof record[key] !== 'string') {
    throw new Error(`Invalid event field: ${key}`);
  }
}

export function parseAttendanceEvent(value: unknown): AttendanceEvent {
  if (!isRecord(value)) throw new Error('Event must be a JSON object');
  if (value.schemaVersion !== 1) {
    throw new Error(`Unsupported event schemaVersion: ${String(value.schemaVersion)}`);
  }
  const eventType = value.eventType;
  if (
    typeof eventType !== 'string' ||
    !EVENT_TYPES.includes(eventType as AttendanceEventType)
  ) {
    throw new Error(`Unsupported eventType: ${String(value.eventType)}`);
  }
  for (const key of ['eventId', 'eventType', 'occurredAt', 'tenantId']) {
    requireString(value, key);
  }
  if (Number.isNaN(Date.parse(value.occurredAt as string))) {
    throw new Error('Invalid event field: occurredAt');
  }
  if (eventType.startsWith('attendance.import.') || eventType.startsWith('payroll.export.')) {
    requireString(value, 'periodId');
  }
  if (eventType.startsWith('attendance.import.')) {
    requireString(value, 'importJobId');
  }
  if (eventType === 'attendance.import.file-ready.v1') {
    requireString(value, 'importFileId');
    requireString(value, 'source');
    if (!isRecord(value.object)) throw new Error('Invalid event field: object');
    for (const key of ['bucket', 'key', 'contentType', 'sizeBytes', 'checksumSha256']) {
      requireString(value.object, key);
    }
  } else if (eventType === 'attendance.import.completed.v1') {
    for (const key of [
      'acceptedRows',
      'rejectedRows',
      'punchesUpserted',
      'attendanceDaysUpdated',
      'exceptionsOpened',
    ]) requireNumber(value, key);
    if (value.status !== 'COMPLETED' && value.status !== 'FAILED') {
      throw new Error('Invalid event field: status');
    }
    requireNullableString(value, 'errorCode');
  } else if (eventType === 'attendance.import.requested.v1') {
    for (const key of ['source', 'requestedBy', 'requestedAt']) requireString(value, key);
  } else if (eventType === 'payroll.export.requested.v1') {
    requireString(value, 'payrollExportId');
    requireString(value, 'requestedBy');
    requireString(value, 'requestedAt');
    requireNumber(value, 'periodVersion');
    if (value.format !== 'CSV' && value.format !== 'XLSX') {
      throw new Error('Invalid event field: format');
    }
  } else if (eventType === 'payroll.export.completed.v1') {
    requireString(value, 'payrollExportId');
    requireNumber(value, 'periodVersion');
    requireNumber(value, 'itemCount');
    if (value.status !== 'READY' && value.status !== 'FAILED') {
      throw new Error('Invalid event field: status');
    }
    requireNullableString(value, 'errorCode');
    if (value.status === 'READY') {
      if (!isRecord(value.object)) throw new Error('Invalid event field: object');
      for (const key of ['bucket', 'key', 'checksumSha256']) {
        requireString(value.object, key);
      }
    } else if (value.object !== null) {
      throw new Error('Invalid event field: object');
    }
  } else if (eventType === 'attendance.day.recompute-requested.v1') {
    requireString(value, 'recomputeJobId');
    requireString(value, 'scopeId');
    requireString(value, 'requestedBy');
    requireString(value, 'requestedAt');
    requireString(value, 'dateFrom');
    requireString(value, 'dateTo');
    if (!POLICY_SCOPE_TYPES.includes(value.scopeType as PolicyScopeType)) {
      throw new Error('Invalid event field: scopeType');
    }
  } else if (eventType === 'attendance.day.recompute-completed.v1') {
    requireString(value, 'recomputeJobId');
    for (const key of ['daysMatched', 'daysRecomputed', 'exceptionsOpened']) {
      requireNumber(value, key);
    }
    if (value.status !== 'COMPLETED' && value.status !== 'FAILED') {
      throw new Error('Invalid event field: status');
    }
    requireNullableString(value, 'errorCode');
  } else {
    throw new Error(`Unhandled eventType: ${eventType}`);
  }
  return value as unknown as AttendanceEvent;
}
