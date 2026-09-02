import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  createEvent,
  type AttendanceImportFileReadyEvent,
} from '@attendance/contracts';
import { Prisma } from '@prisma/client';
import { extname } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { enqueueOutboxEvent } from '../events/outbox';
import { CreateImportUploadDto } from './dto/create-import-upload.dto';

const ALLOWED_UPLOADS = new Map([
  ['.csv', 'text/csv'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
]);

@Injectable()
export class ImportStorageService {
  private readonly s3 = new S3Client({});

  constructor(private readonly prisma: PrismaService) {}

  async createUpload(
    tenantId: string,
    importJobId: string,
    dto: CreateImportUploadDto,
  ) {
    const job = await this.prisma.attendanceImportJob.findFirst({
      where: { id: importJobId, tenantId },
      select: { id: true, status: true },
    });
    if (!job) throw new NotFoundException('Attendance import job not found');
    if (job.status !== 'PENDING') {
      throw new ConflictException('Only pending import jobs accept uploads');
    }

    const extension = extname(dto.fileName).toLowerCase();
    if (ALLOWED_UPLOADS.get(extension) !== dto.contentType.toLowerCase()) {
      throw new BadRequestException(
        'Only CSV and XLSX files with matching content types are supported',
      );
    }
    const maxSizeBytes = this.maxSizeBytes();
    if (dto.sizeBytes > maxSizeBytes) {
      throw new BadRequestException(
        `File exceeds the configured ${maxSizeBytes} byte limit`,
      );
    }

    const bucket = this.importBucket();
    const id = crypto.randomUUID();
    const storageKey = `tenant/${tenantId}/imports/${importJobId}/${id}${extension}`;
    const expiresIn = this.presignExpirySeconds();
    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    const checksumBase64 = Buffer.from(dto.checksumSha256, 'hex').toString(
      'base64',
    );
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      ContentType: dto.contentType.toLowerCase(),
      ChecksumSHA256: checksumBase64,
      Metadata: {
        tenantid: tenantId,
        importjobid: importJobId,
        uploadid: id,
      },
    });
    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn });

    try {
      await this.prisma.attendanceImportUpload.create({
        data: {
          id,
          tenantId,
          importJobId,
          fileName: dto.fileName,
          storageKey,
          contentType: dto.contentType.toLowerCase(),
          sizeBytes: BigInt(dto.sizeBytes),
          checksumSha256: dto.checksumSha256,
          expiresAt,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'This import job already has an upload reservation',
        );
      }
      throw error;
    }

    return {
      uploadId: id,
      method: 'PUT',
      uploadUrl,
      storageKey,
      expiresAt: expiresAt.toISOString(),
      headers: {
        'Content-Type': dto.contentType.toLowerCase(),
        'x-amz-checksum-sha256': checksumBase64,
        'x-amz-meta-tenantid': tenantId,
        'x-amz-meta-importjobid': importJobId,
        'x-amz-meta-uploadid': id,
      },
    };
  }

  async finalizeUpload(
    tenantId: string,
    importJobId: string,
    uploadId: string,
    actorSubject: string,
  ) {
    const reservation = await this.prisma.attendanceImportUpload.findFirst({
      where: { id: uploadId, tenantId, importJobId },
      include: {
        importJob: {
          select: {
            id: true,
            tenantId: true,
            periodId: true,
            source: true,
            status: true,
          },
        },
      },
    });
    if (!reservation) {
      throw new NotFoundException('Upload reservation not found');
    }
    if (reservation.finalizedAt) {
      throw new ConflictException('Upload reservation has already been finalized');
    }
    if (reservation.expiresAt <= new Date()) {
      throw new ConflictException('Upload reservation has expired');
    }
    if (reservation.importJob.status !== 'PENDING') {
      throw new ConflictException('Import job is no longer pending');
    }

    let object;
    try {
      object = await this.s3.send(
        new HeadObjectCommand({
          Bucket: this.importBucket(),
          Key: reservation.storageKey,
          ChecksumMode: 'ENABLED',
        }),
      );
    } catch (error) {
      const statusCode =
        typeof error === 'object' &&
        error !== null &&
        '$metadata' in error &&
        typeof error.$metadata === 'object' &&
        error.$metadata !== null &&
        'httpStatusCode' in error.$metadata
          ? error.$metadata.httpStatusCode
          : undefined;
      if (statusCode === 404) {
        throw new BadRequestException(
          'Uploaded object could not be found; upload it before finalizing',
        );
      }
      throw new ServiceUnavailableException(
        'Uploaded object verification is temporarily unavailable',
      );
    }
    const expectedChecksum = Buffer.from(
      reservation.checksumSha256,
      'hex',
    ).toString('base64');
    const metadata = object.Metadata ?? {};
    if (
      object.ContentLength !== Number(reservation.sizeBytes) ||
      object.ContentType?.toLowerCase() !== reservation.contentType ||
      object.ChecksumSHA256 !== expectedChecksum ||
      metadata.tenantid !== tenantId ||
      metadata.importjobid !== importJobId ||
      metadata.uploadid !== uploadId
    ) {
      throw new BadRequestException(
        'Uploaded object metadata, size, ownership, or checksum does not match the reservation',
      );
    }

    return this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.attendanceImportUpload.updateMany({
          where: {
            id: uploadId,
            tenantId,
            importJobId,
            finalizedAt: null,
            expiresAt: { gt: new Date() },
            importJob: { status: 'PENDING' },
          },
          data: { finalizedAt: new Date() },
        });
        if (claimed.count !== 1) {
          throw new ConflictException(
            'Upload reservation was finalized or expired concurrently',
          );
        }
        const file = await tx.attendanceImportFile.create({
          data: {
            tenantId,
            importJobId,
            fileName: reservation.fileName,
            storageKey: reservation.storageKey,
            contentType: reservation.contentType,
            sizeBytes: reservation.sizeBytes,
            checksum: reservation.checksumSha256,
          },
        });
        const event = createEvent<AttendanceImportFileReadyEvent>(
          'attendance.import.file-ready.v1',
          {
            tenantId,
            periodId: reservation.importJob.periodId,
            importJobId,
            importFileId: file.id,
            source: reservation.importJob.source,
            object: {
              bucket: this.importBucket(),
              key: reservation.storageKey,
              contentType: reservation.contentType,
              sizeBytes: reservation.sizeBytes.toString(),
              checksumSha256: reservation.checksumSha256,
            },
          },
        );
        await enqueueOutboxEvent(
          tx,
          'AttendanceImportJob',
          importJobId,
          event,
        );
        await tx.auditEvent.create({
          data: {
            tenantId,
            actorSubject,
            action: 'attendance.import.file-ready',
            entityType: 'AttendanceImportFile',
            entityId: file.id,
            metadata: {
              importJobId,
              contentType: reservation.contentType,
              sizeBytes: reservation.sizeBytes.toString(),
              checksumSha256: reservation.checksumSha256,
            },
          },
        });
        return {
          ...file,
          sizeBytes: file.sizeBytes.toString(),
          eventId: event.eventId,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private importBucket(): string {
    const bucket = process.env.IMPORT_BUCKET?.trim();
    if (!bucket) {
      throw new ServiceUnavailableException('Import storage is not configured');
    }
    return bucket;
  }

  private maxSizeBytes(): number {
    const value = Number(process.env.ATTENDANCE_IMPORT_MAX_BYTES ?? 26_214_400);
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new ServiceUnavailableException(
        'ATTENDANCE_IMPORT_MAX_BYTES must be a positive integer',
      );
    }
    return value;
  }

  private presignExpirySeconds(): number {
    const value = Number(process.env.ATTENDANCE_UPLOAD_EXPIRY_SECONDS ?? 300);
    if (!Number.isInteger(value) || value < 60 || value > 900) {
      throw new ServiceUnavailableException(
        'ATTENDANCE_UPLOAD_EXPIRY_SECONDS must be between 60 and 900',
      );
    }
    return value;
  }
}
