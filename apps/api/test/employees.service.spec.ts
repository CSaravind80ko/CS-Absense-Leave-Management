import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EmployeesService } from '../src/employees/employees.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('EmployeesService', () => {
  it('returns a conflict when an employee number already exists', async () => {
    const create = jest.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.12.0',
      }),
    );
    const prisma = {
      employee: { create },
      department: { count: jest.fn() },
      location: { count: jest.fn() },
      shift: { count: jest.fn() },
    } as unknown as PrismaService;
    const service = new EmployeesService(prisma);

    await expect(
      service.create('de305d54-75b4-431b-adb2-eb6b9e546014', {
        employeeNumber: 'EMP-001',
        firstName: 'Asha',
        lastName: 'Menon',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
