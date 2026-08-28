import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  Prisma,
  PrismaClient,
  type Employee,
  type Shift,
} from '@prisma/client';
import {
  createEvent,
  type AttendanceEvent,
  type AttendanceImportCompletedEvent,
  type AttendanceImportFileReadyEvent,
  type PayrollExportCompletedEvent,
  type PayrollExportRequestedEvent,
} from '@attendance/contracts';
import { createHash } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DateTime } from 'luxon';
import type { WorkerConfig } from './config';
import { PermanentJobError } from './errors';
import {
  createPayrollCsv,
  createPayrollXlsx,
  type PayrollExportRow,
} from './export-format';
import { parseImportFile, type ParsedImportRow } from './parser';

interface ValidatedRow {
  rowNumber: number;
  values: Record<string, string>;
  employeeId: string | null;
  locationId: string | null;
  occurredAt: Date | null;
  workDate: Date | null;
  punchType: 'IN' | 'OUT' | 'BREAK_START' | 'BREAK_END' | null;
  source: string;
  externalId: string;
  errorCode: string | null;
  errorMessage: string | null;
}

type EmployeeWithShift = Employee & { shift: Shift | null };

export class AttendanceEventProcessor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly s3: S3Client,
    private readonly config: WorkerConfig,
  ) {}

  async process(event: AttendanceEvent): Promise<void> {
    if (event.eventType === 'attendance.import.file-ready.v1') {
      await this.processImport(event);
    } else if (event.eventType === 'payroll.export.requested.v1') {
      await this.processPayroll(event);
    }
  }

  private async processImport(event: AttendanceImportFileReadyEvent): Promise<void> {
    try {
      if (!(await this.claimImport(event))) return;
      const context = await this.prisma.attendanceImportFile.findFirst({
        where: {
          id: event.importFileId,
          tenantId: event.tenantId,
          importJobId: event.importJobId,
          storageKey: event.object.key,
        },
        include: {
          importJob: { include: { period: true } },
          tenant: { select: { timezone: true } },
        },
      });
      if (!context || event.object.bucket !== this.config.importBucket) {
        throw new PermanentJobError(
          'IMPORT_REFERENCE_MISMATCH',
          'Import event references do not match tenant-owned records',
        );
      }
      if (
        context.contentType !== event.object.contentType ||
        context.sizeBytes.toString() !== event.object.sizeBytes ||
        context.checksum !== event.object.checksumSha256
      ) {
        throw new PermanentJobError(
          'IMPORT_OBJECT_MISMATCH',
          'Import object contract does not match the retained file',
        );
      }
      if (!['OPEN', 'PROCESSING'].includes(context.importJob.period.status)) {
        throw new PermanentJobError(
          'PERIOD_NOT_IMPORTABLE',
          'Processing period no longer accepts imports',
        );
      }

      const path = join(tmpdir(), `attendance-${event.eventId}`);
      try {
        await this.downloadImport(event, path);
        const parsed: ParsedImportRow[] = [];
        await parseImportFile(path, context.contentType, this.config, (row) => {
          parsed.push(row);
        });
        const validated = await this.validateRows(
          event,
          parsed,
          context.tenant.timezone,
          context.importJob.period.startsOn,
          context.importJob.period.endsOn,
        );
        await this.persistImport(event, validated, context.tenant.timezone);
      } finally {
        await fs.rm(path, { force: true });
      }
    } catch (error) {
      if (error instanceof PermanentJobError) {
        await this.failImport(event, error);
        return;
      }
      throw error;
    }
  }

  private async claimImport(event: AttendanceImportFileReadyEvent): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.attendanceImportJob.findFirst({
        where: { id: event.importJobId, tenantId: event.tenantId },
      });
      if (!job) {
        throw new PermanentJobError('IMPORT_JOB_NOT_FOUND', 'Import job was not found');
      }
      if (job.status === 'COMPLETED' || job.status === 'FAILED') return false;
      if (job.status === 'PENDING') {
        const claimed = await tx.attendanceImportJob.updateMany({
          where: { id: event.importJobId, tenantId: event.tenantId, status: 'PENDING' },
          data: { status: 'PROCESSING', startedAt: new Date(), errorCode: null, errorMessage: null },
        });
        if (claimed.count !== 1) throw new Error('Import claim was lost');
        await tx.auditEvent.create({
          data: {
            tenantId: event.tenantId,
            actorSubject: 'system:attendance-worker',
            action: 'attendance.import.processing',
            entityType: 'AttendanceImportJob',
            entityId: event.importJobId,
            requestId: event.eventId,
          },
        });
      }
      return true;
    });
  }

  private async downloadImport(
    event: AttendanceImportFileReadyEvent,
    path: string,
  ): Promise<void> {
    const response = await this.s3.send(
      new GetObjectCommand({ Bucket: event.object.bucket, Key: event.object.key }),
    );
    if (!response.Body) throw new Error('S3 returned an empty object body');
    const hash = createHash('sha256');
    let size = 0;
    const verifier = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(response.Body as NodeJS.ReadableStream, verifier, createWriteStream(path));
    if (
      size !== Number(event.object.sizeBytes) ||
      hash.digest('hex') !== event.object.checksumSha256
    ) {
      throw new PermanentJobError(
        'IMPORT_CHECKSUM_MISMATCH',
        'Downloaded import does not match its finalized checksum and size',
      );
    }
  }

  private async validateRows(
    event: AttendanceImportFileReadyEvent,
    rows: ParsedImportRow[],
    timezone: string,
    startsOn: Date,
    endsOn: Date,
  ): Promise<ValidatedRow[]> {
    const [employees, locations] = await this.prisma.$transaction([
      this.prisma.employee.findMany({
        where: { tenantId: event.tenantId },
        include: { shift: true },
      }),
      this.prisma.location.findMany({ where: { tenantId: event.tenantId } }),
    ]);
    const employeesByNumber = new Map(
      employees.map((employee) => [employee.employeeNumber.toLowerCase(), employee]),
    );
    const locationsByCode = new Map(
      locations.map((location) => [location.code.toLowerCase(), location]),
    );
    const seen = new Set<string>();
    const startDate = DateTime.fromJSDate(startsOn, { zone: 'utc' }).toISODate();
    const endDate = DateTime.fromJSDate(endsOn, { zone: 'utc' }).toISODate();

    return rows.map((row) => {
      const values = row.values;
      const employee = employeesByNumber.get(values.employeeNumber?.toLowerCase());
      const occurred = parseOccurredAt(values.occurredAt, timezone);
      const punchType = ['IN', 'OUT', 'BREAK_START', 'BREAK_END'].includes(
        values.punchType?.toUpperCase(),
      )
        ? (values.punchType.toUpperCase() as ValidatedRow['punchType'])
        : null;
      const location = values.locationCode
        ? locationsByCode.get(values.locationCode.toLowerCase())
        : undefined;
      const source = (values.source || event.source).trim();
      const externalId =
        values.externalId?.trim() ||
        `import:${event.importFileId}:${row.rowNumber}`;
      let errorCode: string | null = null;
      let errorMessage: string | null = null;
      const workDateText = occurred?.isValid
        ? occurred.setZone(timezone).toISODate()
        : null;

      const reject = (code: string, message: string) => {
        if (!errorCode) {
          errorCode = code;
          errorMessage = message;
        }
      };
      if (row.formulaFields.length) reject('FORMULA_NOT_ALLOWED', 'Formula cells are not allowed');
      if (!values.employeeNumber) reject('EMPLOYEE_REQUIRED', 'Employee number is required');
      else if (!employee) reject('UNKNOWN_EMPLOYEE', 'Employee number is not tenant-owned');
      else if (employee.status !== 'ACTIVE') reject('INACTIVE_EMPLOYEE', 'Employee is inactive');
      if (!occurred?.isValid) reject('INVALID_DATETIME', 'Punch time format is invalid');
      else {
        const workDate = occurred.setZone(timezone).toISODate();
        if (!workDate || !startDate || !endDate || workDate < startDate || workDate > endDate) {
          reject('OUT_OF_PERIOD', 'Punch time is outside the processing period');
        }
      }
      if (!punchType) reject('INVALID_PUNCH_TYPE', 'Punch type is not supported');
      if (values.locationCode && !location) {
        reject('UNKNOWN_LOCATION', 'Location code is not tenant-owned');
      }
      if (!source || source.length > 50) reject('INVALID_SOURCE', 'Source is required and limited to 50 characters');
      if (externalId.length > 255) reject('INVALID_EXTERNAL_ID', 'External ID exceeds 255 characters');

      const duplicateKey = `${source.toLowerCase()}:${externalId.toLowerCase()}`;
      if (seen.has(duplicateKey)) reject('DUPLICATE_PUNCH', 'Duplicate punch appears in the file');
      seen.add(duplicateKey);

      return {
        rowNumber: row.rowNumber,
        values,
        employeeId: employee?.id ?? null,
        locationId: location?.id ?? null,
        occurredAt: occurred?.isValid ? occurred.toJSDate() : null,
        workDate: workDateText
          ? new Date(`${workDateText}T00:00:00.000Z`)
          : null,
        punchType,
        source,
        externalId,
        errorCode,
        errorMessage,
      };
    });
  }

  private async persistImport(
    event: AttendanceImportFileReadyEvent,
    rows: ValidatedRow[],
    timezone: string,
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const period = await tx.processingPeriod.findFirst({
          where: { id: event.periodId, tenantId: event.tenantId },
        });
        if (!period || !['OPEN', 'PROCESSING'].includes(period.status)) {
          throw new PermanentJobError(
            'PERIOD_NOT_IMPORTABLE',
            'Processing period changed while the import was running',
          );
        }

        await tx.attendanceImportRow.createMany({
          data: rows.map((row) => ({
            tenantId: event.tenantId,
            fileId: event.importFileId,
            rowNumber: row.rowNumber,
            rawData: jsonValue(sanitizeRow(row.values)),
            canonicalData: row.errorCode
              ? undefined
              : jsonValue({
                  employeeNumber: row.values.employeeNumber,
                  occurredAt: row.occurredAt?.toISOString(),
                  punchType: row.punchType,
                  locationCode: row.values.locationCode || null,
                  source: row.source,
                  externalId: row.externalId,
                }),
            status: row.errorCode ? 'INVALID' : 'VALID',
            errorCode: row.errorCode,
            validationError: row.errorMessage,
          })),
          skipDuplicates: true,
        });
        const retainedRows = await tx.attendanceImportRow.findMany({
          where: { tenantId: event.tenantId, fileId: event.importFileId },
          select: { id: true, rowNumber: true },
        });
        const retainedByNumber = new Map(
          retainedRows.map((row) => [row.rowNumber, row.id]),
        );
        const valid = rows.filter(
          (row) =>
            !row.errorCode &&
            row.employeeId &&
            row.occurredAt &&
            row.workDate &&
            row.punchType,
        );
        const punchCreate = await tx.attendancePunch.createMany({
          data: valid.map((row) => ({
            tenantId: event.tenantId,
            employeeId: row.employeeId!,
            importRowId: retainedByNumber.get(row.rowNumber),
            locationId: row.locationId,
            occurredAt: row.occurredAt!,
            type: row.punchType!,
            source: row.source,
            externalId: row.externalId,
            metadata: jsonValue({
              importFileId: event.importFileId,
              rowNumber: row.rowNumber,
            }),
          })),
          skipDuplicates: true,
        });
        await tx.attendanceImportRow.updateMany({
          where: {
            tenantId: event.tenantId,
            fileId: event.importFileId,
            status: 'VALID',
          },
          data: { status: 'PROCESSED' },
        });

        const invalidExceptions = rows
          .filter((row) =>
            ['UNKNOWN_EMPLOYEE', 'INACTIVE_EMPLOYEE', 'OUT_OF_PERIOD', 'DUPLICATE_PUNCH'].includes(
              row.errorCode ?? '',
            ),
          )
          .map((row) => ({
            tenantId: event.tenantId,
            employeeId: row.employeeId,
            importJobId: event.importJobId,
            type: exceptionType(row.errorCode!),
            severity: row.errorCode === 'UNKNOWN_EMPLOYEE' ? 'HIGH' as const : 'MEDIUM' as const,
            payrollImpact: 'REVIEW_REQUIRED' as const,
            dedupeKey: `import:${event.importJobId}:row:${row.rowNumber}:${row.errorCode}`,
            details: jsonValue({
              importJobId: event.importJobId,
              rowNumber: row.rowNumber,
              employeeNumber: row.values.employeeNumber || null,
              errorCode: row.errorCode,
            }),
          }));
        const invalidExceptionCreate = invalidExceptions.length
          ? await tx.attendanceException.createMany({
              data: invalidExceptions,
              skipDuplicates: true,
            })
          : { count: 0 };

        const affected = new Map<string, { employeeId: string; workDate: Date }>();
        for (const row of valid) {
          const workDate = row.workDate!;
          affected.set(`${row.employeeId}:${workDate.toISOString()}`, {
            employeeId: row.employeeId!,
            workDate,
          });
        }
        let attendanceDaysUpdated = 0;
        let dayExceptionsOpened = 0;
        for (const item of affected.values()) {
          const result = await recomputeDay(
            tx,
            event,
            item.employeeId,
            item.workDate,
            timezone,
          );
          attendanceDaysUpdated += 1;
          dayExceptionsOpened += result.exceptionsOpened;
        }
        const acceptedRows = valid.length;
        const rejectedRows = rows.length - acceptedRows;
        const exceptionsOpened = invalidExceptionCreate.count + dayExceptionsOpened;
        const completed = createEvent<AttendanceImportCompletedEvent>(
          'attendance.import.completed.v1',
          {
            tenantId: event.tenantId,
            periodId: event.periodId,
            importJobId: event.importJobId,
            status: 'COMPLETED',
            acceptedRows,
            rejectedRows,
            punchesUpserted: punchCreate.count,
            attendanceDaysUpdated,
            exceptionsOpened,
            errorCode: null,
          },
        );
        await tx.attendanceImportJob.update({
          where: { id: event.importJobId },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            acceptedRows,
            rejectedRows,
            punchesUpserted: punchCreate.count,
            attendanceDaysUpdated,
            exceptionsOpened,
            errorCode: null,
            errorMessage: null,
          },
        });
        await createOutbox(tx, 'AttendanceImportJob', event.importJobId, completed);
        await tx.auditEvent.create({
          data: {
            tenantId: event.tenantId,
            actorSubject: 'system:attendance-worker',
            action: 'attendance.import.completed',
            entityType: 'AttendanceImportJob',
            entityId: event.importJobId,
            requestId: event.eventId,
            metadata: jsonValue({
              acceptedRows,
              rejectedRows,
              punchesUpserted: punchCreate.count,
              attendanceDaysUpdated,
              exceptionsOpened,
            }),
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 120_000,
      },
    );
  }

  private async failImport(
    event: AttendanceImportFileReadyEvent,
    error: PermanentJobError,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.attendanceImportJob.updateMany({
        where: {
          id: event.importJobId,
          tenantId: event.tenantId,
          status: { in: ['PENDING', 'PROCESSING'] },
        },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorCode: error.code,
          errorMessage: error.message.slice(0, 1000),
        },
      });
      if (!updated.count) return;
      const failed = createEvent<AttendanceImportCompletedEvent>(
        'attendance.import.completed.v1',
        {
          tenantId: event.tenantId,
          periodId: event.periodId,
          importJobId: event.importJobId,
          status: 'FAILED',
          acceptedRows: 0,
          rejectedRows: 0,
          punchesUpserted: 0,
          attendanceDaysUpdated: 0,
          exceptionsOpened: 0,
          errorCode: error.code,
        },
      );
      await createOutbox(tx, 'AttendanceImportJob', event.importJobId, failed);
      await tx.auditEvent.create({
        data: {
          tenantId: event.tenantId,
          actorSubject: 'system:attendance-worker',
          action: 'attendance.import.failed',
          entityType: 'AttendanceImportJob',
          entityId: event.importJobId,
          requestId: event.eventId,
          metadata: { errorCode: error.code },
        },
      });
    });
  }

  private async processPayroll(event: PayrollExportRequestedEvent): Promise<void> {
    try {
      const claimed = await this.claimPayroll(event);
      if (!claimed) return;
      const exportData = await this.prisma.payrollExport.findFirst({
        where: { id: event.payrollExportId, tenantId: event.tenantId },
        include: { period: true },
      });
      if (!exportData) {
        throw new PermanentJobError('PAYROLL_EXPORT_NOT_FOUND', 'Payroll export was not found');
      }
      await this.assertPayrollReady(event);
      const employees = await this.prisma.employee.findMany({
        where: {
          tenantId: event.tenantId,
          attendanceDays: { some: { periodId: event.periodId } },
        },
        include: {
          attendanceDays: {
            where: { periodId: event.periodId },
          },
        },
        orderBy: { employeeNumber: 'asc' },
      });
      const rows: PayrollExportRow[] = employees.map((employee) => ({
        employeeNumber: employee.employeeNumber,
        employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
        regularMinutes: employee.attendanceDays.reduce(
          (sum, day) => sum + Math.min(day.workedMinutes, day.scheduledMinutes),
          0,
        ),
        overtimeMinutes: employee.attendanceDays.reduce(
          (sum, day) => sum + day.overtimeMinutes,
          0,
        ),
        unpaidMinutes: employee.attendanceDays.reduce(
          (sum, day) =>
            sum + Math.max(
              0,
              day.scheduledMinutes -
                Math.max(0, day.workedMinutes - day.overtimeMinutes),
            ),
          0,
        ),
      }));
      const body =
        event.format === 'CSV'
          ? createPayrollCsv(rows)
          : await createPayrollXlsx(rows);
      const checksum = createHash('sha256').update(body).digest('hex');
      const extension = event.format.toLowerCase();
      const key = `tenant/${event.tenantId}/payroll/${event.payrollExportId}/register.${extension}`;
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.config.exportBucket,
          Key: key,
          Body: body,
          ContentType:
            event.format === 'CSV'
              ? 'text/csv; charset=utf-8'
              : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          ChecksumSHA256: Buffer.from(checksum, 'hex').toString('base64'),
          ServerSideEncryption: 'aws:kms',
          Metadata: {
            tenantid: event.tenantId,
            payrollexportid: event.payrollExportId,
            periodversion: String(event.periodVersion),
          },
        }),
      );
      await this.completePayroll(event, rows, key, body.length, checksum);
    } catch (error) {
      if (error instanceof PermanentJobError) {
        await this.failPayroll(event, error);
        return;
      }
      throw error;
    }
  }

  private async claimPayroll(event: PayrollExportRequestedEvent): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const payrollExport = await tx.payrollExport.findFirst({
        where: { id: event.payrollExportId, tenantId: event.tenantId },
      });
      if (!payrollExport) {
        throw new PermanentJobError('PAYROLL_EXPORT_NOT_FOUND', 'Payroll export was not found');
      }
      if (payrollExport.status === 'READY' || payrollExport.status === 'FAILED') return false;
      if (payrollExport.status === 'DRAFT') {
        const claimed = await tx.payrollExport.updateMany({
          where: {
            id: event.payrollExportId,
            tenantId: event.tenantId,
            periodId: event.periodId,
            periodVersion: event.periodVersion,
            status: 'DRAFT',
          },
          data: { status: 'GENERATING', version: { increment: 1 }, errorCode: null },
        });
        if (claimed.count !== 1) {
          throw new PermanentJobError('PAYROLL_REQUEST_MISMATCH', 'Payroll request contract is stale');
        }
        await tx.auditEvent.create({
          data: {
            tenantId: event.tenantId,
            actorSubject: 'system:attendance-worker',
            action: 'payroll.export.generating',
            entityType: 'PayrollExport',
            entityId: event.payrollExportId,
            requestId: event.eventId,
          },
        });
      }
      return true;
    });
  }

  private async assertPayrollReady(event: PayrollExportRequestedEvent): Promise<void> {
    const period = await this.prisma.processingPeriod.findFirst({
      where: {
        id: event.periodId,
        tenantId: event.tenantId,
        status: 'APPROVED',
        version: event.periodVersion,
      },
    });
    if (!period) {
      throw new PermanentJobError(
        'PERIOD_VERSION_STALE',
        'Approved processing period version changed before generation',
      );
    }
    const blockers = await this.prisma.attendanceException.count({
      where: {
        tenantId: event.tenantId,
        status: 'OPEN',
        attendanceDay: { periodId: event.periodId },
        OR: [{ severity: 'CRITICAL' }, { payrollImpact: 'BLOCKED' }],
      },
    });
    if (blockers) {
      throw new PermanentJobError(
        'CRITICAL_BLOCKERS',
        'Critical attendance blockers prevent payroll generation',
      );
    }
  }

  private async completePayroll(
    event: PayrollExportRequestedEvent,
    rows: PayrollExportRow[],
    key: string,
    sizeBytes: number,
    checksum: string,
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const period = await tx.processingPeriod.findFirst({
          where: {
            id: event.periodId,
            tenantId: event.tenantId,
            status: 'APPROVED',
            version: event.periodVersion,
          },
        });
        const blockers = await tx.attendanceException.count({
          where: {
            tenantId: event.tenantId,
            status: 'OPEN',
            attendanceDay: { periodId: event.periodId },
            OR: [{ severity: 'CRITICAL' }, { payrollImpact: 'BLOCKED' }],
          },
        });
        if (!period || blockers) {
          throw new PermanentJobError(
            !period ? 'PERIOD_VERSION_STALE' : 'CRITICAL_BLOCKERS',
            'Payroll eligibility changed while the file was being generated',
          );
        }
        const employees = await tx.employee.findMany({
          where: {
            tenantId: event.tenantId,
            employeeNumber: { in: rows.map((row) => row.employeeNumber) },
          },
          select: { id: true, employeeNumber: true },
        });
        const byNumber = new Map(employees.map((employee) => [employee.employeeNumber, employee.id]));
        await tx.payrollExportItem.createMany({
          data: rows.map((row) => ({
            tenantId: event.tenantId,
            payrollExportId: event.payrollExportId,
            employeeId: byNumber.get(row.employeeNumber)!,
            regularMinutes: row.regularMinutes,
            overtimeMinutes: row.overtimeMinutes,
            unpaidMinutes: row.unpaidMinutes,
            payload: jsonValue({
              employeeNumber: row.employeeNumber,
              employeeName: row.employeeName,
            }),
          })),
          skipDuplicates: true,
        });
        await tx.payrollExport.update({
          where: { id: event.payrollExportId },
          data: {
            status: 'READY',
            storageBucket: this.config.exportBucket,
            storageKey: key,
            checksum,
            sizeBytes: BigInt(sizeBytes),
            generatedAt: new Date(),
            errorCode: null,
            version: { increment: 1 },
          },
        });
        const completed = createEvent<PayrollExportCompletedEvent>(
          'payroll.export.completed.v1',
          {
            tenantId: event.tenantId,
            periodId: event.periodId,
            periodVersion: event.periodVersion,
            payrollExportId: event.payrollExportId,
            status: 'READY',
            itemCount: rows.length,
            object: {
              bucket: this.config.exportBucket,
              key,
              checksumSha256: checksum,
            },
            errorCode: null,
          },
        );
        await createOutbox(tx, 'PayrollExport', event.payrollExportId, completed);
        await tx.auditEvent.create({
          data: {
            tenantId: event.tenantId,
            actorSubject: 'system:attendance-worker',
            action: 'payroll.export.ready',
            entityType: 'PayrollExport',
            entityId: event.payrollExportId,
            requestId: event.eventId,
            metadata: { itemCount: rows.length, checksumSha256: checksum },
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 120_000,
      },
    );
  }

  private async failPayroll(
    event: PayrollExportRequestedEvent,
    error: PermanentJobError,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.payrollExport.updateMany({
        where: {
          id: event.payrollExportId,
          tenantId: event.tenantId,
          status: { in: ['DRAFT', 'GENERATING'] },
        },
        data: { status: 'FAILED', errorCode: error.code, version: { increment: 1 } },
      });
      if (!updated.count) return;
      const completed = createEvent<PayrollExportCompletedEvent>(
        'payroll.export.completed.v1',
        {
          tenantId: event.tenantId,
          periodId: event.periodId,
          periodVersion: event.periodVersion,
          payrollExportId: event.payrollExportId,
          status: 'FAILED',
          itemCount: 0,
          object: null,
          errorCode: error.code,
        },
      );
      await createOutbox(tx, 'PayrollExport', event.payrollExportId, completed);
      await tx.auditEvent.create({
        data: {
          tenantId: event.tenantId,
          actorSubject: 'system:attendance-worker',
          action: 'payroll.export.failed',
          entityType: 'PayrollExport',
          entityId: event.payrollExportId,
          requestId: event.eventId,
          metadata: { errorCode: error.code },
        },
      });
    });
  }
}

function parseOccurredAt(value: string, timezone: string): DateTime | null {
  if (!value) return null;
  const iso = DateTime.fromISO(value, { setZone: true });
  if (iso.isValid && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return iso;
  for (const format of ['yyyy-MM-dd HH:mm:ss', 'yyyy-MM-dd HH:mm']) {
    const parsed = DateTime.fromFormat(value, format, { zone: timezone });
    if (parsed.isValid) return parsed;
  }
  return null;
}

function sanitizeRow(values: Record<string, string>): Record<string, string | null> {
  return {
    employeeNumber: values.employeeNumber || null,
    occurredAt: values.occurredAt || null,
    punchType: values.punchType || null,
    externalId: values.externalId || null,
    locationCode: values.locationCode || null,
    source: values.source || null,
  };
}

function exceptionType(
  code: string,
): 'UNKNOWN_EMPLOYEE' | 'INACTIVE_EMPLOYEE' | 'OUT_OF_PERIOD' | 'DUPLICATE_PUNCH' {
  if (code === 'UNKNOWN_EMPLOYEE') return 'UNKNOWN_EMPLOYEE';
  if (code === 'INACTIVE_EMPLOYEE') return 'INACTIVE_EMPLOYEE';
  if (code === 'OUT_OF_PERIOD') return 'OUT_OF_PERIOD';
  return 'DUPLICATE_PUNCH';
}

async function recomputeDay(
  tx: Prisma.TransactionClient,
  event: AttendanceImportFileReadyEvent,
  employeeId: string,
  workDate: Date,
  timezone: string,
): Promise<{ exceptionsOpened: number }> {
  const workDateText = workDate.toISOString().slice(0, 10);
  const rangeStart = DateTime.fromISO(workDateText, { zone: timezone })
    .startOf('day')
    .toUTC()
    .toJSDate();
  const rangeEnd = DateTime.fromISO(workDateText, { zone: timezone })
    .plus({ days: 1 })
    .startOf('day')
    .toUTC()
    .toJSDate();
  const employee = await tx.employee.findFirst({
    where: { id: employeeId, tenantId: event.tenantId },
    include: { shift: true },
  }) as EmployeeWithShift | null;
  if (!employee) throw new PermanentJobError('EMPLOYEE_NOT_FOUND', 'Employee disappeared during import');
  const punches = await tx.attendancePunch.findMany({
    where: {
      tenantId: event.tenantId,
      employeeId,
      occurredAt: { gte: rangeStart, lt: rangeEnd },
    },
    orderBy: { occurredAt: 'asc' },
  });
  let openIn: Date | null = null;
  let workedMinutes = 0;
  let breakStartedAt: Date | null = null;
  let breakMinutes = 0;
  let invalidSequence = false;
  for (const punch of punches) {
    if (punch.type === 'IN') {
      if (openIn) invalidSequence = true;
      else {
        openIn = punch.occurredAt;
        breakMinutes = 0;
      }
    } else if (punch.type === 'BREAK_START') {
      if (!openIn || breakStartedAt) invalidSequence = true;
      else breakStartedAt = punch.occurredAt;
    } else if (punch.type === 'BREAK_END') {
      if (!openIn || !breakStartedAt) invalidSequence = true;
      else {
        breakMinutes += Math.max(
          0,
          Math.round(
            (punch.occurredAt.getTime() - breakStartedAt.getTime()) / 60_000,
          ),
        );
        breakStartedAt = null;
      }
    } else if (punch.type === 'OUT') {
      if (!openIn || breakStartedAt) invalidSequence = true;
      else {
        workedMinutes += Math.max(
          0,
          Math.round(
            (punch.occurredAt.getTime() - openIn.getTime()) / 60_000,
          ) - breakMinutes,
        );
        openIn = null;
        breakMinutes = 0;
      }
    }
  }
  const missingPunch = Boolean(openIn || breakStartedAt) || !punches.some((punch) => punch.type === 'IN') ||
    !punches.some((punch) => punch.type === 'OUT');
  const shiftMinutes = employee.shift
    ? ((employee.shift.endMinutes - employee.shift.startMinutes + 1440) % 1440) -
      employee.shift.breakMinutes
    : 0;
  const scheduledMinutes = Math.max(0, shiftMinutes);
  const overtimeMinutes = Math.max(0, workedMinutes - scheduledMinutes);
  const sourceSummary = Object.fromEntries(
    Array.from(new Set(punches.map((punch) => punch.source))).map((source) => [
      source,
      punches.filter((punch) => punch.source === source).length,
    ]),
  );
  const day = await tx.attendanceDay.upsert({
    where: {
      tenantId_employeeId_workDate: {
        tenantId: event.tenantId,
        employeeId,
        workDate,
      },
    },
    create: {
      tenantId: event.tenantId,
      periodId: event.periodId,
      employeeId,
      workDate,
      status: workedMinutes === 0 ? 'ABSENT' : scheduledMinutes && workedMinutes < scheduledMinutes ? 'PARTIAL' : 'PRESENT',
      scheduledMinutes,
      workedMinutes,
      overtimeMinutes,
      firstPunchAt: punches[0]?.occurredAt,
      lastPunchAt: punches.at(-1)?.occurredAt,
      sourceSummary,
    },
    update: {
      periodId: event.periodId,
      status: workedMinutes === 0 ? 'ABSENT' : scheduledMinutes && workedMinutes < scheduledMinutes ? 'PARTIAL' : 'PRESENT',
      scheduledMinutes,
      workedMinutes,
      overtimeMinutes,
      firstPunchAt: punches[0]?.occurredAt ?? null,
      lastPunchAt: punches.at(-1)?.occurredAt ?? null,
      sourceSummary,
      version: { increment: 1 },
    },
  });
  const exceptions: Prisma.AttendanceExceptionCreateManyInput[] = [];
  if (missingPunch) {
    exceptions.push({
      tenantId: event.tenantId,
      employeeId,
      attendanceDayId: day.id,
      importJobId: event.importJobId,
      type: 'MISSING_PUNCH',
      severity: 'HIGH',
      payrollImpact: 'BLOCKED',
      dedupeKey: `day:${day.id}:missing-punch`,
      details: { workDate: workDate.toISOString().slice(0, 10) },
    });
  }
  if (invalidSequence) {
    exceptions.push({
      tenantId: event.tenantId,
      employeeId,
      attendanceDayId: day.id,
      importJobId: event.importJobId,
      type: 'DUPLICATE_PUNCH',
      severity: 'MEDIUM',
      payrollImpact: 'REVIEW_REQUIRED',
      dedupeKey: `day:${day.id}:invalid-sequence`,
      details: { workDate: workDate.toISOString().slice(0, 10) },
    });
  }
  const created = exceptions.length
    ? await tx.attendanceException.createMany({ data: exceptions, skipDuplicates: true })
    : { count: 0 };
  return { exceptionsOpened: created.count };
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value));
}

async function createOutbox(
  tx: Prisma.TransactionClient,
  aggregateType: string,
  aggregateId: string,
  event: AttendanceEvent,
): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      eventId: event.eventId,
      tenantId: event.tenantId,
      aggregateType,
      aggregateId,
      eventType: event.eventType,
      payload: jsonValue(event),
    },
  });
}
