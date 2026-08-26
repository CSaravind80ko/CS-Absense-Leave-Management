import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Employee } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string): Promise<Employee[]> {
    return this.prisma.employee.findMany({
      where: { tenantId },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  async get(tenantId: string, id: string): Promise<Employee> {
    const employee = await this.prisma.employee.findFirst({
      where: { id, tenantId },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  async create(tenantId: string, dto: CreateEmployeeDto): Promise<Employee> {
    await this.validateReferences(tenantId, dto);
    return this.prisma.employee.create({
      data: {
        tenantId,
        employeeNumber: dto.employeeNumber,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        departmentId: dto.departmentId,
        locationId: dto.locationId,
        shiftId: dto.shiftId,
        status: dto.status,
        hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined,
      },
    });
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateEmployeeDto,
  ): Promise<Employee> {
    await this.get(tenantId, id);
    await this.validateReferences(tenantId, dto);
    return this.prisma.employee.update({
      where: { id },
      data: dto,
    });
  }

  private async validateReferences(
    tenantId: string,
    dto: {
      departmentId?: string;
      locationId?: string;
      shiftId?: string;
    },
  ): Promise<void> {
    const checks: Promise<number>[] = [];
    if (dto.departmentId)
      checks.push(
        this.prisma.department.count({
          where: { id: dto.departmentId, tenantId },
        }),
      );
    if (dto.locationId)
      checks.push(
        this.prisma.location.count({ where: { id: dto.locationId, tenantId } }),
      );
    if (dto.shiftId)
      checks.push(
        this.prisma.shift.count({ where: { id: dto.shiftId, tenantId } }),
      );
    const results = await Promise.all(checks);
    if (results.some((count) => count !== 1)) {
      throw new BadRequestException('Related records must belong to the tenant');
    }
  }
}
