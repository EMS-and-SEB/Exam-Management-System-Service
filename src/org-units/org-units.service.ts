import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { AppException } from '../common/exceptions/app-exceptions.js';
import { StaffRole } from '../generated/prisma/client.js';

@Injectable()
export class OrgUnitsService {
  constructor(private readonly prisma: PrismaService) {}

  async getScopedIds(callerOrgUnitId: string): Promise<string[]> {
    const rows = await this.prisma.orgUnitClosure.findMany({
      where: { ancestorId: callerOrgUnitId },
      select: { descendantId: true },
    });
    return rows.map((r) => r.descendantId);
  }

  async listScoped(callerOrgUnitId: string) {
    const ids = await this.getScopedIds(callerOrgUnitId);
    return this.prisma.orgUnit.findMany({ where: { id: { in: ids } }, orderBy: { createdAt: 'asc' } });
  }

  async createChild(name: string, parentId: string, tx: Prisma.TransactionClient) {
    const unit = await tx.orgUnit.create({ data: { name, parentId } });
    const parentAncestors = await tx.orgUnitClosure.findMany({ where: { descendantId: parentId } });
    await tx.orgUnitClosure.createMany({
      data: [
        ...parentAncestors.map((row) => ({
          ancestorId: row.ancestorId,
          descendantId: unit.id,
          depth: row.depth + 1,
        })),
        { ancestorId: unit.id, descendantId: unit.id, depth: 0 },
      ],
    });
    return unit;
  }

    async resolveCreateTarget(
    requestedOrgUnitId: string | undefined,
    caller: { role: StaffRole; orgUnitId: string },
  ): Promise<string> {
    if (caller.role === StaffRole.UNIT_ADMIN) {
      return caller.orgUnitId;
    }
    if (!requestedOrgUnitId) {
      throw AppException.badRequest('orgUnitId is required.');
    }
    const scopedIds = await this.getScopedIds(caller.orgUnitId);
    if (!scopedIds.includes(requestedOrgUnitId)) {
      throw AppException.forbidden('You can only create resources within your own org unit or its descendants.');
    }
    const target = await this.prisma.orgUnit.findUnique({
      where: { id: requestedOrgUnitId },
      select: { parentId: true },
    });
    if (target?.parentId === null) {
      throw AppException.badRequest('Choose a specific unit — courses and cohorts cannot belong to the root institution unit.');
    }
    return requestedOrgUnitId;
  }
}