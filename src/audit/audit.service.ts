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
        where: { actorId: userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { actor: { select: { name: true } } },
      }),
      this.prisma.auditLog.count({ where: { actorId: userId } }),
    ]);
    return { entries: await this.enrichEntries(entries), page, pageSize: limit, total, totalPages: Math.ceil(total / limit) };
  }

  async findRecent(limit: number) {
    const entries = await this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { actor: { select: { name: true } } },
    });
    return { entries: await this.enrichEntries(entries) };
  }

  private async enrichEntries<T extends { action: string; entityType: string; entityId: string; metadata: Prisma.JsonValue | null }>(
    entries: T[],
  ) {
    return Promise.all(
      entries.map(async (entry) => {
        if (entry.action === 'STAFF_INVITATION_ACCEPTED') return entry;
        if (this.getDisplayName(entry.metadata)) return entry;

        const displayName = await this.findEntityDisplayName(entry.entityType, entry.entityId, entry.metadata);
        if (!displayName) return entry;

        const metadata =
          entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
            ? entry.metadata
            : {};

        return { ...entry, metadata: { ...metadata, displayName } };
      }),
    );
  }

  private getDisplayName(metadata: Prisma.JsonValue | null) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
    const displayName = metadata.displayName;
    return typeof displayName === 'string' ? displayName : null;
  }

  private async findEntityDisplayName(entityType: string, entityId: string, metadata: Prisma.JsonValue | null) {
    switch (entityType) {
      case 'Course':
        return (await this.prisma.course.findUnique({ where: { id: entityId }, select: { name: true } }))?.name ?? null;
      case 'Cohort':
        return (await this.prisma.cohort.findUnique({ where: { id: entityId }, select: { name: true } }))?.name ?? null;
      case 'StaffAccount':
        return (await this.prisma.staffAccount.findUnique({ where: { id: entityId }, select: { name: true } }))?.name ?? null;
      case 'OrgUnit':
        return (await this.prisma.orgUnit.findUnique({ where: { id: entityId }, select: { name: true } }))?.name ?? null;
      case 'Exam':
        return (await this.prisma.exam.findUnique({ where: { id: entityId }, select: { title: true } }))?.title ?? null;
      case 'Enrollment':
      case 'CohortMember': {
        const studentId = this.getMetadataString(metadata, 'studentId');
        return studentId
          ? (await this.prisma.studentDirectory.findUnique({ where: { id: studentId }, select: { name: true } }))?.name ?? null
          : null;
      }
      default:
        return null;
    }
  }

  private getMetadataString(metadata: Prisma.JsonValue | null, key: string) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
    const value = metadata[key];
    return typeof value === 'string' ? value : null;
  }
}