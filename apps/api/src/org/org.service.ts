import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface OrgUnitOption {
  id: string;
  name: string;
  code: string;
}

@Injectable()
export class OrgService {
  constructor(private readonly prisma: PrismaService) {}

  async listDepartments(tenantId: string): Promise<OrgUnitOption[]> {
    return this.prisma.department.findMany({
      where: { tenantId },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
  }

  async listLocations(tenantId: string): Promise<OrgUnitOption[]> {
    return this.prisma.location.findMany({
      where: { tenantId },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
  }
}
