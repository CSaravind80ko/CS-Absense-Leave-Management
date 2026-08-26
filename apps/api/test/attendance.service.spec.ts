import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { AttendanceService } from '../src/attendance/attendance.service';

describe('AttendanceService', () => {
  const count = jest.fn();
  const create = jest.fn();
  const prisma = {
    processingPeriod: { count, create },
  } as unknown as PrismaService;
  const service = new AttendanceService(prisma);

  beforeEach(() => {
    count.mockReset();
    create.mockReset();
  });

  it('rejects an inverted processing period', async () => {
    await expect(
      service.createPeriod('tenant', {
        name: 'Invalid',
        startsOn: '2026-02-10',
        endsOn: '2026-02-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(count).not.toHaveBeenCalled();
  });

  it('rejects an overlapping processing period', async () => {
    count.mockResolvedValue(1);
    await expect(
      service.createPeriod('tenant', {
        name: 'February',
        startsOn: '2026-02-01',
        endsOn: '2026-02-28',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
