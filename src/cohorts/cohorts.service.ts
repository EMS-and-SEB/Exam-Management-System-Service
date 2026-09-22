import { Injectable } from '@nestjs/common';
import { CohortStatus, StaffRole, SessionStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppException } from '../common/exceptions/app-exceptions.js';
import { buildOwnerScopeWhere, assertOwnsOrIsAdmin } from '../common/utils/ownership.util.js';
import { parseRosterCsv } from '../common/utils/csv-parser.util.js';
import { StudentsService } from '../students/students.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditAction } from '../audit/audit.const.js';

interface CallerContext {
  staffId: string;
  role: StaffRole;
}

@Injectable()
export class CohortsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly studentsService: StudentsService
  ) {}

  async create(name: string, coordinatorId: string, callerId: string) {
    return this.prisma.$transaction(async (tx) => {
      const cohort = await tx.cohort.create({ data: { name, coordinatorId } });
      await this.auditService.log(
        { actorId: callerId, action: AuditAction.COHORT_CREATED, entityType: 'Cohort', entityId: cohort.id },
        tx,
      );
      return cohort;
    });
  }

   async findAll(caller: CallerContext) {
    return this.prisma.cohort.findMany({
      where: buildOwnerScopeWhere(caller.role, caller.staffId, 'coordinatorId'),
      include: { coordinator: true },
    });
  }

  async findOne(id: string, caller: CallerContext) {
    return this.assertOwnsCohort(id, caller);
  }

  async update(id: string, data: { name?: string; coordinatorId?: string; status?: CohortStatus }, callerId: string) {
    const cohort = await this.prisma.cohort.findUnique({ where: { id } });
    if (!cohort) throw AppException.notFound('Cohort not found.');
    const isArchiving = data.status === 'ARCHIVED' && cohort.status !== 'ARCHIVED';
    return this.prisma.$transaction(async (tx) => {
      const updatedCohort = await tx.cohort.update({ where: { id }, data });
      if (isArchiving) {
        await this.auditService.log(
          { actorId: callerId, action: AuditAction.COHORT_ARCHIVED, entityType: 'Cohort', entityId: updatedCohort.id },
          tx,
        );
      }
      return updatedCohort;
    });
  }

  async addOne(cohortId: string, studentId: string, name: string, caller: CallerContext) {
    await this.assertOwnsCohort(cohortId, caller);
    const student = await this.studentsService.findOrCreateByStudentId(studentId, name);
    const member = await this.prisma.cohortMember.create({ data: { cohortId, studentId: student.id } });
    return { member };
  }

  async addSelected(cohortId: string, studentIds: string[], caller: CallerContext) {
    await this.assertOwnsCohort(cohortId, caller);

    const uniqueIds = [...new Set(studentIds)];

    const existing = await this.prisma.cohortMember.findMany({
      where: { cohortId, studentId: { in: uniqueIds }, deletedAt: null },
      select: { studentId: true },
    });
    const existingSet = new Set(existing.map((m) => m.studentId));
    const toAdd = uniqueIds.filter((id) => !existingSet.has(id));

    if (toAdd.length > 0) {
      await this.prisma.cohortMember.createMany({
        data: toAdd.map((studentId) => ({ cohortId, studentId })),
        skipDuplicates: true,
      });
    }

    return { added: toAdd.length, alreadyMember: existingSet.size };
  }

  async addBulk(cohortId: string, file: Express.Multer.File, caller: CallerContext) {
    await this.assertOwnsCohort(cohortId, caller);
    const { rows, errors } = parseRosterCsv(file.buffer);
    if (rows.length === 0) return { created: 0, alreadyExisted: 0, added: 0, errors };

    const studentIds = [...new Set(rows.map((r) => r.studentId))];

    const existingStudents = await this.prisma.studentDirectory.findMany({
      where: { studentId: { in: studentIds } },
    });
    const knownIds = new Set(existingStudents.map((s) => s.studentId));
    const newRows = [...new Map(
      rows.filter((r) => !knownIds.has(r.studentId)).map((r) => [r.studentId, r]),
    ).values()];

    const existingMembers = await this.prisma.cohortMember.findMany({
      where: { cohortId, deletedAt: null },
      select: { studentId: true },
    });
    const alreadyMemberSet = new Set(existingMembers.map((m) => m.studentId));

    const [, toAdd] = await this.prisma.$transaction(async (tx) => {
      const created = newRows.length > 0
        ? await tx.studentDirectory.createManyAndReturn({
            data: newRows.map((r) => ({ studentId: r.studentId, name: r.name })),
            skipDuplicates: true,
          })
        : [];

      const allStudents = [...existingStudents, ...created];
      const toAddList = allStudents.filter((s) => !alreadyMemberSet.has(s.id));

      if (toAddList.length > 0) {
        await tx.cohortMember.createMany({
          data: toAddList.map((s) => ({ cohortId, studentId: s.id })),
          skipDuplicates: true,
        });
      }

      return [created, toAddList] as const;
    });

    return { created: newRows.length, alreadyExisted: existingStudents.length, added: toAdd.length, errors };
  }

  async listMembers(cohortId: string, caller: CallerContext) {
    await this.assertOwnsCohort(cohortId, caller);
    return this.prisma.cohortMember.findMany({
      where: { cohortId, deletedAt: null },
      include: { student: true },
    });
  }

  async removeMember(cohortId: string, studentId: string, caller: CallerContext) {
    await this.assertOwnsCohort(cohortId, caller);

    const member = await this.prisma.cohortMember.findFirst({ where: { cohortId, studentId, deletedAt: null } });
    if (!member) throw AppException.notFound('Cohort member not found.');

    const hasTakenExam = await this.prisma.examSession.findFirst({
      where: {
        exam: { cohortId },
        studentId,
        status: { not: SessionStatus.NOT_STARTED },
      },
    });

    if (hasTakenExam) {
      await this.prisma.cohortMember.update({
        where: { id: member.id },
        data: { deletedAt: new Date() },
      });
    } else {
      await this.prisma.cohortMember.delete({ where: { id: member.id } });
    }
  }

  private async assertOwnsCohort(cohortId: string, caller: CallerContext) {
    const cohort = await this.prisma.cohort.findUnique({ where: { id: cohortId } });
    if (!cohort) throw AppException.notFound('Cohort not found.');
    assertOwnsOrIsAdmin(cohort.coordinatorId, caller.staffId, caller.role);
    return cohort;
  }
}