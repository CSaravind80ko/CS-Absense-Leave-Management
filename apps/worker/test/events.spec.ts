import {
  createEvent,
  parseAttendanceEvent,
  type AttendanceImportFileReadyEvent,
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
});
