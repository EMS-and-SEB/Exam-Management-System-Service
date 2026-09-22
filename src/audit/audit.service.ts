import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { AuditAction } from './audit.const.js';

interface AuditEntry {
  actorId?: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry, tx: Prisma.TransactionClient | PrismaService = this.prisma) {
    await tx.auditLog.create({
        data: {
        actorId: entry.actorId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        metadata: entry.metadata,
        },
    });
    }

  async findForUser(userId: string, page: number, limit: number) {
    const [entries, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where: { entityId: userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { actor: { select: { name: true } } },
      }),
      this.prisma.auditLog.count({ where: { entityId: userId } }),
    ]);
    return { entries, page, pageSize: limit, total, totalPages: Math.ceil(total / limit) };
  }

  async findRecent(limit: number) {
    const entries = await this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { actor: { select: { name: true } } },
    });
    return { entries };
  }
}