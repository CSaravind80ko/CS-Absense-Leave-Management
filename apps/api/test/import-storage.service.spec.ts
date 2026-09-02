import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ImportStorageService } from '../src/attendance/import-storage.service';
import { PrismaService } from '../src/prisma/prisma.service';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

const tenantId = 'de305d54-75b4-431b-adb2-eb6b9e546014';
const jobId = 'c56a4180-65aa-42ec-a945-5fd21dec0538';
const uploadId = '8d11d74a-e6b1-4a4c-9104-59538a65f28d';
const checksum = 'a'.repeat(64);

describe('ImportStorageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.IMPORT_BUCKET = 'private-imports';
    process.env.ATTENDANCE_IMPORT_MAX_BYTES = '1024';
    process.env.ATTENDANCE_UPLOAD_EXPIRY_SECONDS = '300';
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects extension and content-type mismatches before signing', async () => {
    const prisma = {
      attendanceImportJob: {
        findFirst: jest.fn().mockResolvedValue({ id: jobId, status: 'PENDING' }),
      },
    } as unknown as PrismaService;
    await expect(
      new ImportStorageService(prisma).createUpload(tenantId, jobId, {
        fileName: 'punches.csv',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sizeBytes: 10,
        checksumSha256: checksum,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('signs a tenant/job-derived key with a required checksum', async () => {
    (getSignedUrl as jest.Mock).mockResolvedValue('https://signed.example/upload');
    const create = jest.fn().mockResolvedValue({});
    const prisma = {
      attendanceImportJob: {
        findFirst: jest.fn().mockResolvedValue({ id: jobId, status: 'PENDING' }),
      },
      attendanceImportUpload: { create },
    } as unknown as PrismaService;
    const result = await new ImportStorageService(prisma).createUpload(
      tenantId,
      jobId,
      {
        fileName: 'punches.csv',
        contentType: 'text/csv',
        sizeBytes: 10,
        checksumSha256: checksum,
      },
    );
    expect(result.storageKey).toMatch(
      new RegExp(`^tenant/${tenantId}/imports/${jobId}/[a-f0-9-]+\\.csv$`),
    );
    expect(result.headers['x-amz-checksum-sha256']).toBe(
      Buffer.from(checksum, 'hex').toString('base64'),
    );
    expect(result.headers).toEqual(
      expect.objectContaining({
        'x-amz-meta-tenantid': tenantId,
        'x-amz-meta-importjobid': jobId,
        'x-amz-meta-uploadid': expect.any(String),
      }),
    );
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId, importJobId: jobId, checksumSha256: checksum }),
    });
  });

  it('does not reveal or finalize a reservation from another tenant', async () => {
    const send = jest.spyOn(S3Client.prototype, 'send');
    const prisma = {
      attendanceImportUpload: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    await expect(
      new ImportStorageService(prisma).finalizeUpload(tenantId, jobId, uploadId, 'actor'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects a finalized object when HEAD ownership metadata differs', async () => {
    jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({
      ContentLength: 10,
      ContentType: 'text/csv',
      ChecksumSHA256: Buffer.from(checksum, 'hex').toString('base64'),
      Metadata: {
        tenantid: 'other-tenant',
        importjobid: jobId,
        uploadid: uploadId,
      },
    } as never);
    const prisma = {
      attendanceImportUpload: {
        findFirst: jest.fn().mockResolvedValue({
          id: uploadId,
          tenantId,
          importJobId: jobId,
          fileName: 'punches.csv',
          storageKey: `tenant/${tenantId}/imports/${jobId}/${uploadId}.csv`,
          contentType: 'text/csv',
          sizeBytes: BigInt(10),
          checksumSha256: checksum,
          expiresAt: new Date(Date.now() + 60_000),
          finalizedAt: null,
          importJob: {
            periodId: jobId,
            source: 'MANUAL_FILE',
            status: 'PENDING',
          },
        }),
      },
      $transaction: jest.fn(),
    } as unknown as PrismaService;
    await expect(
      new ImportStorageService(prisma).finalizeUpload(tenantId, jobId, uploadId, 'actor'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('finalizes once and writes file, event, and audit in one transaction', async () => {
    jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({
      ContentLength: 10,
      ContentType: 'text/csv',
      ChecksumSHA256: Buffer.from(checksum, 'hex').toString('base64'),
      Metadata: { tenantid: tenantId, importjobid: jobId, uploadid: uploadId },
    } as never);
    const reservation = {
      id: uploadId,
      tenantId,
      importJobId: jobId,
      fileName: 'punches.csv',
      storageKey: `tenant/${tenantId}/imports/${jobId}/${uploadId}.csv`,
      contentType: 'text/csv',
      sizeBytes: BigInt(10),
      checksumSha256: checksum,
      expiresAt: new Date(Date.now() + 60_000),
      finalizedAt: null,
      importJob: {
        periodId: jobId,
        source: 'MANUAL_FILE',
        status: 'PENDING',
      },
    };
    const file = {
      id: uploadId,
      tenantId,
      importJobId: jobId,
      fileName: reservation.fileName,
      storageKey: reservation.storageKey,
      contentType: reservation.contentType,
      sizeBytes: reservation.sizeBytes,
      checksum,
      createdAt: new Date(),
    };
    const tx = {
      attendanceImportUpload: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      attendanceImportFile: { create: jest.fn().mockResolvedValue(file) },
      outboxEvent: { create: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      attendanceImportUpload: {
        findFirst: jest.fn().mockResolvedValue(reservation),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    } as unknown as PrismaService;
    await expect(
      new ImportStorageService(prisma).finalizeUpload(
        tenantId,
        jobId,
        uploadId,
        'actor',
      ),
    ).resolves.toEqual(expect.objectContaining({ id: uploadId, sizeBytes: '10' }));
    expect(tx.attendanceImportUpload.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: uploadId,
          tenantId,
          importJobId: jobId,
          finalizedAt: null,
        }),
      }),
    );
    expect(tx.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId,
        eventType: 'attendance.import.file-ready.v1',
      }),
    });
    expect(tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorSubject: 'actor',
        action: 'attendance.import.file-ready',
      }),
    });
  });
});
