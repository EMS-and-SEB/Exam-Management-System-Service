import { Injectable } from '@nestjs/common';
import { CohortStatus, StaffRole, SessionStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppException } from '../common/exceptions/app-exceptions.js';
import { buildOwnerScopeWhere, assertOwnsOrIsAdmin } from '../common/utils/ownership.util.js';
import { findNameMismatches, parseRosterCsv } from '../common/utils/csv-parser.util.js';
import { StudentsService } from '../students/students.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditAction } from '../audit/audit.const.js';
import { OrgUnitsService } from '../org-units/org-units.service.js';

interface CallerContext {
  staffId: string;
  role: StaffRole;
  orgUnitId: string;
}

@Injectable()
export class CohortsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly studentsService: StudentsService,
    private readonly orgUnitsService: OrgUnitsService,
  ) {}

    async create(name: string, coordinatorId: string, orgUnitId: string | undefined, caller: CallerContext) {
      const targetOrgUnitId = await this.orgUnitsService.resolveCreateTarget(orgUnitId, caller);
      await this.assertAssignableCoordinator(coordinatorId, targetOrgUnitId);
      return this.prisma.$transaction(async (tx) => {
        const cohort = await tx.cohort.create({
          data: { name, coordinatorId, orgUnitId: targetOrgUnitId },
        });
        await this.auditService.log(
          {
            actorId: caller.staffId,
            action: AuditAction.COHORT_CREATED,
            entityType: 'Cohort',
            entityId: cohort.id,
            metadata: { displayName: cohort.name },
          },
          tx,
        );
        return cohort;
      });
    }

  async findAll(caller: CallerContext) {
    const scopedOrgUnitIds = await this.orgUnitsService.getScopedIds(caller.orgUnitId);
    return this.prisma.cohort.findMany({
      where: buildOwnerScopeWhere(caller.role, caller.staffId, 'coordinatorId', scopedOrgUnitIds),
      include: { coordinator: true },
    });
  }

  async findOne(id: string, caller: CallerContext) {
    return this.assertOwnsCohort(id, caller);
  }

  async update(id: string, data: { name?: string; coordinatorId?: string; status?: CohortStatus }, caller: CallerContext) {
    const cohort = await this.assertOwnsCohort(id, caller);
    if (data.coordinatorId) await this.assertAssignableCoordinator(data.coordinatorId, cohort.orgUnitId);
    const isArchiving = data.status === 'ARCHIVED' && cohort.status !== 'ARCHIVED';
    return this.prisma.$transaction(async (tx) => {
      const updatedCohort = await tx.cohort.update({ where: { id }, data });
      if (isArchiving) {
        await this.auditService.log(
        {
          actorId: caller.staffId,
          action: AuditAction.COHORT_ARCHIVED,
          entityType: 'Cohort',
          entityId: updatedCohort.id,
          metadata: { displayName: updatedCohort.name },
        },
        tx,
        );
      }
      return updatedCohort;
    });
  }

  async addOne(cohortId: string, studentId: string, name: string, caller: CallerContext) {
    await this.assertOwnsCohort(cohortId, caller);
    const student = await this.studentsService.findOrCreateByStudentId(studentId, name);

    const existing = await this.prisma.cohortMember.findFirst({
      where: { cohortId, studentId: student.id },
    });

    if (existing) {
      if (!existing.deletedAt) {
        throw AppException.conflict('This student is already a member of this cohort.');
      }
      const member = await this.prisma.cohortMember.update({
        where: { id: existing.id },
        data: { deletedAt: null },
      });
      return { member };
    }

    const member = await this.prisma.cohortMember.create({ data: { cohortId, studentId: student.id } });
    return { member };
  }

  async addSelected(cohortId: string, studentIds: string[], caller: CallerContext) {
    await this.assertOwnsCohort(cohortId, caller);

    const uniqueIds = [...new Set(studentIds)];

    const existing = await this.prisma.cohortMember.findMany({
      where: { cohortId, studentId: { in: uniqueIds } },
      select: { id: true, studentId: true, deletedAt: true },
    });
    const activeCount = existing.filter((m) => !m.deletedAt).length;
    const removedRowIds = existing.filter((m) => m.deletedAt).map((m) => m.id);
    const knownIds = new Set(existing.map((m) => m.studentId));
    const toAdd = uniqueIds.filter((id) => !knownIds.has(id));

    await this.prisma.$transaction([
      ...(removedRowIds.length > 0
        ? [this.prisma.cohortMember.updateMany({ where: { id: { in: removedRowIds } }, data: { deletedAt: null } })]
        : []),
      ...(toAdd.length > 0
        ? [this.prisma.cohortMember.createMany({
            data: toAdd.map((studentId) => ({ cohortId, studentId })),
            skipDuplicates: true,
          })]
        : []),
    ]);

    return { added: removedRowIds.length + toAdd.length, alreadyMember: activeCount };
  }

  async import(cohortId: string, file: Express.Multer.File, caller: CallerContext) {
    await this.assertOwnsCohort(cohortId, caller);
    const { rows, errors } = parseRosterCsv(file.buffer);
    if (rows.length === 0) return { created: 0, alreadyExisted: 0, added: 0, nameMismatches: [], errors };

    const studentIds = [...new Set(rows.map((r) => r.studentId))];

    const existingStudents = await this.prisma.studentDirectory.findMany({
      where: { studentId: { in: studentIds } },
    });
    const nameMismatches = findNameMismatches(rows, existingStudents);
    const knownStudentIds = new Set(existingStudents.map((s) => s.studentId));
    const newRows = [...new Map(
      rows.filter((r) => !knownStudentIds.has(r.studentId)).map((r) => [r.studentId, r]),
    ).values()];

    const { created, added } = await this.prisma.$transaction(async (tx) => {
      const createdStudents = newRows.length > 0
        ? await tx.studentDirectory.createManyAndReturn({
            data: newRows.map((r) => ({ studentId: r.studentId, name: r.name })),
            skipDuplicates: true,
          })
        : [];

      const allStudents = [...existingStudents, ...createdStudents];

      const existingMembers = await tx.cohortMember.findMany({
        where: { cohortId, studentId: { in: allStudents.map((s) => s.id) } },
        select: { id: true, studentId: true, deletedAt: true },
      });
      const removedRowIds = existingMembers.filter((m) => m.deletedAt).map((m) => m.id);
      const alreadyLinkedIds = new Set(existingMembers.map((m) => m.studentId));

      if (removedRowIds.length > 0) {
        await tx.cohortMember.updateMany({ where: { id: { in: removedRowIds } }, data: { deletedAt: null } });
      }

      const toAdd = allStudents.filter((s) => !alreadyLinkedIds.has(s.id));
      if (toAdd.length > 0) {
        await tx.cohortMember.createMany({
          data: toAdd.map((s) => ({ cohortId, studentId: s.id })),
          skipDuplicates: true,
        });
      }

      return { created: createdStudents, added: toAdd.length + removedRowIds.length };
    });

    return { created: created.length, alreadyExisted: existingStudents.length, added, nameMismatches, errors };
  }

  async listMembers(cohortId: string, caller: CallerContext) {
    await this.assertOwnsCohort(cohortId, caller);
    return this.prisma.cohortMember.findMany({
      where: { cohortId, deletedAt: null },
      include: { student: true },
    });
  }

    async removeMember(cohortId: string, studentId: string, caller: CallerContext) {
    const cohort = await this.assertOwnsCohort(cohortId, caller);

    const member = await this.prisma.cohortMember.findFirst({
      where: { cohortId, student: { studentId }, deletedAt: null },
      include: { student: { select: { name: true } } },
    });
    if (!member) throw AppException.notFound('Cohort member not found.');

    const hasTakenExam = await this.prisma.examSession.findFirst({
      where: {
        exam: { cohortId },
        studentId: member.studentId,
        status: { not: SessionStatus.NOT_STARTED },
      },
    });

    await this.prisma.$transaction(async (tx) => {
      if (hasTakenExam) {
        await tx.cohortMember.update({
          where: { id: member.id },
          data: { deletedAt: new Date() },
        });
      } else {
        await tx.cohortMember.delete({ where: { id: member.id } });
      }
      await this.auditService.log(
        {
          actorId: caller.staffId,
          action: AuditAction.COHORT_MEMBER_REMOVED,
          entityType: 'CohortMember',
          entityId: member.id,
          metadata: {
            displayName: member.student.name,
            cohortName: cohort.name,
            cohortId,
            studentId: member.studentId,
            historyPreserved: Boolean(hasTakenExam),
          },
        },
        tx,
      );
    });
  }

  private async assertOwnsCohort(cohortId: string, caller: CallerContext) {
    const cohort = await this.prisma.cohort.findUnique({ where: { id: cohortId } });
    if (!cohort) throw AppException.notFound('Cohort not found.');
    const scopedOrgUnitIds = await this.orgUnitsService.getScopedIds(caller.orgUnitId);
    assertOwnsOrIsAdmin(cohort.orgUnitId, cohort.coordinatorId, caller.staffId, caller.role, scopedOrgUnitIds);
    return cohort;
  }

  private async assertAssignableCoordinator(coordinatorId: string, orgUnitId: string) {
    const coordinator = await this.prisma.staffAccount.findUnique({
      where: { id: coordinatorId },
      select: { role: true, isActive: true, orgUnitId: true },
    });
    if (!coordinator || coordinator.role !== StaffRole.EXIT_EXAM_COORDINATOR || !coordinator.isActive) {
      throw AppException.badRequest('Select an active coordinator.');
    }
    if (coordinator.orgUnitId !== orgUnitId) {
      throw AppException.badRequest('The coordinator must belong to the selected unit.');
    }
  }
}