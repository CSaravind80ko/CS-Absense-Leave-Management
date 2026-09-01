import {
  createEvent,
  parseAttendanceEvent,
  type AttendanceImportFileReadyEvent,
  type AttendanceDayRecomputeRequestedEvent,
  type AttendanceDayRecomputeCompletedEvent,
} from '@attendance/contracts';

describe('attendance event contracts', () => {
  it('accepts the exact file-ready v1 envelope', () => {
    const event = createEvent<AttendanceImportFileReadyEvent>(
      'attendance.import.file-ready.v1',
      {
        tenantId: 'de305d54-75b4-431b-adb2-eb6b9e546014',
        periodId: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
        importJobId: '8d11d74a-e6b1-4a4c-9104-59538a65f28d',
        importFileId: '81d4fae4-6c11-4bb5-9170-eea7fe9d9dd0',
        source: 'MANUAL_FILE',
        object: {
          bucket: 'private',
          key: 'tenant/example/import.csv',
          contentType: 'text/csv',
          sizeBytes: '10',
          checksumSha256: 'a'.repeat(64),
        },
      },
    );
    expect(parseAttendanceEvent(event)).toEqual(event);
  });

  it('rejects unknown schema versions before processing', () => {
    expect(() =>
      parseAttendanceEvent({
        schemaVersion: 2,
        eventType: 'attendance.import.file-ready.v1',
      }),
    ).toThrow('Unsupported event schemaVersion');
  });

  it('rejects unknown event types', () => {
    expect(() =>
      parseAttendanceEvent({
        schemaVersion: 1,
        eventType: 'attendance.import.file-ready.v2',
      }),
    ).toThrow('Unsupported eventType');
  });

  it('rejects an import event missing periodId (regression for the recompute-event periodId fix)', () => {
    const event = createEvent<AttendanceImportFileReadyEvent>(
      'attendance.import.file-ready.v1',
      {
        tenantId: 'de305d54-75b4-431b-adb2-eb6b9e546014',
        periodId: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
        importJobId: '8d11d74a-e6b1-4a4c-9104-59538a65f28d',
        importFileId: '81d4fae4-6c11-4bb5-9170-eea7fe9d9dd0',
        source: 'MANUAL_FILE',
        object: {
          bucket: 'private',
          key: 'tenant/example/import.csv',
          contentType: 'text/csv',
          sizeBytes: '10',
          checksumSha256: 'a'.repeat(64),
        },
      },
    );
    const { periodId: _periodId, ...withoutPeriodId } = event;
    expect(() => parseAttendanceEvent(withoutPeriodId)).toThrow(
      'Invalid event field: periodId',
    );
  });

  it('accepts a recompute-requested v1 envelope with no periodId', () => {
    const event = createEvent<AttendanceDayRecomputeRequestedEvent>(
      'attendance.day.recompute-requested.v1',
      {
        tenantId: 'de305d54-75b4-431b-adb2-eb6b9e546014',
        recomputeJobId: '2c6f9a8e-1c8a-4e3f-9a2b-6e7d8f9c0a1b',
        scopeType: 'EMPLOYEE_GROUP',
        scopeId: 'a1b2c3d4-e5f6-4789-9abc-def012345678',
        dateFrom: '2026-08-01',
        dateTo: '2026-08-31',
        requestedBy: 'tenant-admin@example.com',
        requestedAt: new Date().toISOString(),
      },
    );
    expect(parseAttendanceEvent(event)).toEqual(event);
    expect((event as Record<string, unknown>).periodId).toBeUndefined();
  });

  it('accepts a recompute-completed v1 envelope', () => {
    const event = createEvent<AttendanceDayRecomputeCompletedEvent>(
      'attendance.day.recompute-completed.v1',
      {
        tenantId: 'de305d54-75b4-431b-adb2-eb6b9e546014',
        recomputeJobId: '2c6f9a8e-1c8a-4e3f-9a2b-6e7d8f9c0a1b',
        status: 'COMPLETED',
        daysMatched: 40,
        daysRecomputed: 40,
        exceptionsOpened: 3,
        errorCode: null,
      },
    );
    expect(parseAttendanceEvent(event)).toEqual(event);
  });

  it('rejects a recompute-requested event with an invalid scopeType', () => {
    const event = createEvent<AttendanceDayRecomputeRequestedEvent>(
      'attendance.day.recompute-requested.v1',
      {
        tenantId: 'de305d54-75b4-431b-adb2-eb6b9e546014',
        recomputeJobId: '2c6f9a8e-1c8a-4e3f-9a2b-6e7d8f9c0a1b',
        scopeType: 'EMPLOYEE_GROUP',
        scopeId: 'a1b2c3d4-e5f6-4789-9abc-def012345678',
        dateFrom: '2026-08-01',
        dateTo: '2026-08-31',
        requestedBy: 'tenant-admin@example.com',
        requestedAt: new Date().toISOString(),
      },
    );
    expect(() =>
      parseAttendanceEvent({ ...event, scopeType: 'DIVISION' }),
    ).toThrow('Invalid event field: scopeType');
  });
});
