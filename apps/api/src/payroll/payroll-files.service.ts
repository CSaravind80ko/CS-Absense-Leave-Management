import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PayrollFilesService {
  private readonly s3 = new S3Client({});

  constructor(private readonly prisma: PrismaService) {}

  async createDownload(tenantId: string, payrollExportId: string) {
    const payrollExport = await this.prisma.payrollExport.findFirst({
      where: { id: payrollExportId, tenantId },
      include: { period: { select: { version: true } } },
    });
    if (!payrollExport) throw new NotFoundException('Payroll export not found');
    if (
      payrollExport.status !== 'READY' ||
      !payrollExport.storageKey ||
      !payrollExport.storageBucket
    ) {
      throw new ConflictException('Payroll export file is not ready');
    }
    if (payrollExport.period.version !== payrollExport.periodVersion) {
      throw new ConflictException(
        'Payroll export is stale because the processing period changed',
      );
    }
    const expiresIn = Number(process.env.PAYROLL_DOWNLOAD_EXPIRY_SECONDS ?? 300);
    if (!Number.isInteger(expiresIn) || expiresIn < 60 || expiresIn > 900) {
      throw new ServiceUnavailableException(
        'PAYROLL_DOWNLOAD_EXPIRY_SECONDS must be between 60 and 900',
      );
    }
    const downloadUrl = await getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: payrollExport.storageBucket,
        Key: payrollExport.storageKey,
        ResponseContentDisposition: `attachment; filename="attendance-payroll-${payrollExport.id}.${payrollExport.format.toLowerCase()}"`,
      }),
      { expiresIn },
    );
    return {
      downloadUrl,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      checksumSha256: payrollExport.checksum,
    };
  }
}
