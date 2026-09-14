import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditAction } from '../audit/audit.const.js';

@Injectable()
export class RetentionPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async get() {
    const policy = await this.getOrCreate();
    return { resultRetentionDays: policy.resultRetentionDays, updatedAt: policy.updatedAt };
  }

  async update(resultRetentionDays: number, callerId: string) {
    const existing = await this.getOrCreate();

    const policy = await this.prisma.$transaction(async (tx) => {
      const result = await tx.retentionPolicy.update({
        where: { id: existing.id },
        data: { resultRetentionDays, updatedById: callerId },
      });
      await this.auditService.log(
        { actorId: callerId, action: AuditAction.RETENTION_POLICY_CHANGED, entityType: 'RetentionPolicy', entityId: result.id },
        tx,
      );
      return result;
    });

    return { resultRetentionDays: policy.resultRetentionDays, updatedAt: policy.updatedAt };
  }

  private async getOrCreate() {
    const existing = await this.prisma.retentionPolicy.findFirst();
    if (existing) return existing;
    const firstAdmin = await this.prisma.staffAccount.findFirstOrThrow({ where: { role: 'EXAM_ADMIN' } });
    return this.prisma.retentionPolicy.create({ data: { updatedById: firstAdmin.id } });
  }
}