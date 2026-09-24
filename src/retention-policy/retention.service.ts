import { Injectable, Logger } from '@nestjs/common';
import { AuditAction } from '../audit/audit.const.js';
import { AuditService } from '../audit/audit.service.js';
import { ExamStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class RetentionPolicyService {
  private readonly logger = new Logger(RetentionPolicyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async get() {
    const policy = await this.getOrCreate();
    return {
      resultRetentionDays: policy.resultRetentionDays,
      updatedAt: policy.updatedAt,
    };
  }

  async update(resultRetentionDays: number, callerId: string) {
    const existing = await this.getOrCreate();

    const policy = await this.prisma.$transaction(async (tx) => {
      const result = await tx.retentionPolicy.update({
        where: { id: existing.id },
        data: { resultRetentionDays, updatedById: callerId },
      });
      await this.auditService.log(
        {
          actorId: callerId,
          action: AuditAction.RETENTION_POLICY_CHANGED,
          entityType: 'RetentionPolicy',
          entityId: result.id,
        },
        tx,
      );
      return result;
    });

    return {
      resultRetentionDays: policy.resultRetentionDays,
      updatedAt: policy.updatedAt,
    };
  }

  /**
   * Purge student data for CLOSED exams whose retention window has elapsed.
   * The exam stub is retained and marked with dataPurgedAt so the purge
   * is auditable and idempotent.
   *
   * Deletes, per eligible exam:
   *   Incident -> Answer -> ExamSession
   *   ExamRoster, ExamOTP, ExamInvigilator
   *
   * Keeps: Exam (stub), ExamQuestion (no student data), source Questions,
   * AuditLog entries.
   */
  async purgeExpiredData(callerId: string) {
    const policy = await this.getOrCreate();
    const cutoff = new Date(
      Date.now() - policy.resultRetentionDays * 24 * 60 * 60 * 1000,
    );

    const eligible = await this.prisma.exam.findMany({
      where: {
        status: ExamStatus.CLOSED,
        closedAt: { lt: cutoff },
        dataPurgedAt: null,
      },
      select: { id: true, title: true },
    });

    if (eligible.length === 0) {
      return { purgedCount: 0, purgedExams: [] as string[] };
    }

    const purgedIds: string[] = [];

    for (const exam of eligible) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const sessions = await tx.examSession.findMany({
            where: { examId: exam.id },
            select: { id: true },
          });
          const sessionIds = sessions.map((s) => s.id);

          if (sessionIds.length > 0) {
            await tx.incident.deleteMany({
              where: { sessionId: { in: sessionIds } },
            });
            await tx.answer.deleteMany({
              where: { sessionId: { in: sessionIds } },
            });
            await tx.examSession.deleteMany({
              where: { id: { in: sessionIds } },
            });
          }

          await tx.examRoster.deleteMany({ where: { examId: exam.id } });
          await tx.examOTP.deleteMany({ where: { examId: exam.id } });
          await tx.examInvigilator.deleteMany({ where: { examId: exam.id } });

          await tx.exam.update({
            where: { id: exam.id },
            data: { dataPurgedAt: new Date() },
          });

          await this.auditService.log(
            {
              actorId: callerId,
              action: AuditAction.DATA_PURGED,
              entityType: 'Exam',
              entityId: exam.id,
              metadata: {
                title: exam.title,
                sessionCount: sessionIds.length,
                retentionDays: policy.resultRetentionDays,
              },
            },
            tx,
          );
        });
        purgedIds.push(exam.id);
      } catch (err) {
        this.logger.error(
          `Failed to purge exam ${exam.id} (${exam.title}): ${(err as Error).message}`,
        );
      }
    }

    return { purgedCount: purgedIds.length, purgedExams: purgedIds };
  }

  private async getOrCreate() {
    const existing = await this.prisma.retentionPolicy.findFirst();
    if (existing) return existing;
    const firstAdmin = await this.prisma.staffAccount.findFirstOrThrow({
      where: { role: 'EXAM_ADMIN' },
    });
    return this.prisma.retentionPolicy.create({
      data: { updatedById: firstAdmin.id },
    });
  }
}
