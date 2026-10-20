import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { StudentsService } from '../students/students.service.js';
import { AppException } from '../common/exceptions/app-exceptions.js';
import { buildOwnerScopeWhere, assertOwnsOrIsAdmin } from '../common/utils/ownership.util.js';
import { findNameMismatches, parseRosterCsv } from '../common/utils/csv-parser.util.js';
import { Prisma, StaffRole, CourseStatus, SessionStatus } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditAction } from '../audit/audit.const.js';
import { OrgUnitsService } from '../org-units/org-units.service.js';

interface CallerContext {
  staffId: string;
  role: StaffRole;
  orgUnitId: string;
}

@Injectable()
export class CoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly studentsService: StudentsService,
    private readonly orgUnitsService: OrgUnitsService,
  ) {}

  async create(name: string, instructorId: string, orgUnitId: string | undefined, caller: CallerContext) {
    const targetOrgUnitId = await this.orgUnitsService.resolveCreateTarget(orgUnitId, caller);
    await this.assertAssignableInstructor(instructorId, targetOrgUnitId);

    return this.prisma.$transaction(async (tx) => {
      const course = await tx.course.create({
        data: { name, instructorId, orgUnitId: targetOrgUnitId },
      });
      await this.auditService.log(
        {
          actorId: caller.staffId,
          action: AuditAction.COURSE_CREATED,
          entityType: 'Course',
          entityId: course.id,
          metadata: { displayName: course.name },
        },
        tx,
      );
      return course;
    });
  }

  async findAll(caller: CallerContext) {
    const scopedOrgUnitIds = await this.orgUnitsService.getScopedIds(caller.orgUnitId);
    return this.prisma.course.findMany({
      where: buildOwnerScopeWhere(caller.role, caller.staffId, 'instructorId', scopedOrgUnitIds),
      include: { instructor: true },
    });
  }

  async findOne(id: string, caller: CallerContext) {
    const course = await this.assertOwnsCourse(id, caller);
    return course;
  }

  async update(id: string, data: { name?: string; instructorId?: string; status?: CourseStatus }, caller: CallerContext) {
    const course = await this.assertOwnsCourse(id, caller);
    if (data.instructorId) await this.assertAssignableInstructor(data.instructorId, course.orgUnitId);

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "Course" WHERE id = ${id} FOR UPDATE`);
      const current = await tx.course.findUnique({ where: { id } });
      if (!current) throw AppException.notFound('Course not found.');
      if (current.status === CourseStatus.ARCHIVED && data.instructorId) {
        throw AppException.conflict('Staff cannot be reassigned while a course is archived.');
      }
      const isArchiving = data.status === CourseStatus.ARCHIVED && current.status !== CourseStatus.ARCHIVED;
      const isRestoring = data.status === CourseStatus.ACTIVE && current.status === CourseStatus.ARCHIVED;
      if (isArchiving) await this.assertNoOpenActivities(id, tx);
      const updated = await tx.course.update({ where: { id }, data });
      if (isArchiving) {
        await this.auditService.log(
        {
          actorId: caller.staffId,
          action: AuditAction.COURSE_ARCHIVED,
          entityType: 'Course',
          entityId: id,
          metadata: { displayName: updated.name },
        },
        tx,
        );
      }
      if (isRestoring) {
        await this.auditService.log(
          { actorId: caller.staffId, action: AuditAction.COURSE_RESTORED, entityType: 'Course', entityId: id, metadata: { displayName: updated.name } },
          tx,
        );
      }
      return updated;
    });
  }

  async enrollOne(courseId: string, studentId: string, name: string, caller: CallerContext) {
    const course = await this.assertOwnsCourse(courseId, caller);
    this.assertCourseActive(course.status);
    const student = await this.studentsService.findOrCreateByStudentId(studentId, name);

    const existing = await this.prisma.enrollment.findFirst({
      where: { courseId, studentId: student.id },
    });

    if (existing) {
      if (!existing.deletedAt) {
        throw AppException.conflict('This student is already enrolled in this course.');
      }
      const enrollment = await this.prisma.$transaction(async (tx) => {
        await this.lockActiveCourse(tx, courseId, caller.staffId);
        return tx.enrollment.update({ where: { id: existing.id }, data: { deletedAt: null } });
      });
      return { enrollment };
    }

    const enrollment = await this.prisma.$transaction(async (tx) => {
      await this.lockActiveCourse(tx, courseId, caller.staffId);
      return tx.enrollment.create({ data: { courseId, studentId: student.id } });
    });
    return { enrollment };
  }

  async enrollSelected(courseId: string, studentIds: string[], caller: CallerContext) {
    const course = await this.assertOwnsCourse(courseId, caller);
    this.assertCourseActive(course.status);

    const uniqueIds = [...new Set(studentIds)];

    const existing = await this.prisma.enrollment.findMany({
      where: { courseId, studentId: { in: uniqueIds } },
      select: { id: true, studentId: true, deletedAt: true },
    });
    const activeCount = existing.filter((e) => !e.deletedAt).length;
    const removedRowIds = existing.filter((e) => e.deletedAt).map((e) => e.id);
    const knownIds = new Set(existing.map((e) => e.studentId));
    const toCreate = uniqueIds.filter((id) => !knownIds.has(id));

    await this.prisma.$transaction(async (tx) => {
      await this.lockActiveCourse(tx, courseId, caller.staffId);
      if (removedRowIds.length > 0) {
        await tx.enrollment.updateMany({ where: { id: { in: removedRowIds } }, data: { deletedAt: null } });
      }
      if (toCreate.length > 0) {
        await tx.enrollment.createMany({ data: toCreate.map((studentId) => ({ courseId, studentId })), skipDuplicates: true });
      }
    });

    return { enrolled: removedRowIds.length + toCreate.length, alreadyEnrolled: activeCount };
  }

  async enrollBulk(courseId: string, file: Express.Multer.File, caller: CallerContext) {
    const course = await this.assertOwnsCourse(courseId, caller);
    this.assertCourseActive(course.status);
    const { rows, errors } = parseRosterCsv(file.buffer);
    if (rows.length === 0) return { created: 0, alreadyExisted: 0, enrolled: 0, nameMismatches: [], errors };

    const studentIds = [...new Set(rows.map((r) => r.studentId))];

    const existingStudents = await this.prisma.studentDirectory.findMany({
      where: { studentId: { in: studentIds } },
    });
    const nameMismatches = findNameMismatches(rows, existingStudents);
    const knownStudentIds = new Set(existingStudents.map((s) => s.studentId));
    const newRows = [...new Map(
      rows.filter((r) => !knownStudentIds.has(r.studentId)).map((r) => [r.studentId, r]),
    ).values()];

    const { created, enrolled } = await this.prisma.$transaction(async (tx) => {
      await this.lockActiveCourse(tx, courseId, caller.staffId);
      const createdStudents = newRows.length > 0
        ? await tx.studentDirectory.createManyAndReturn({
            data: newRows.map((r) => ({ studentId: r.studentId, name: r.name })),
            skipDuplicates: true,
          })
        : [];

      const allStudents = [...existingStudents, ...createdStudents];

      const existingEnrollments = await tx.enrollment.findMany({
        where: { courseId, studentId: { in: allStudents.map((s) => s.id) } },
        select: { id: true, studentId: true, deletedAt: true },
      });
      const removedRowIds = existingEnrollments.filter((e) => e.deletedAt).map((e) => e.id);
      const alreadyLinkedIds = new Set(existingEnrollments.map((e) => e.studentId));

      if (removedRowIds.length > 0) {
        await tx.enrollment.updateMany({ where: { id: { in: removedRowIds } }, data: { deletedAt: null } });
      }

      const toCreate = allStudents.filter((s) => !alreadyLinkedIds.has(s.id));
      if (toCreate.length > 0) {
        await tx.enrollment.createMany({
          data: toCreate.map((s) => ({ courseId, studentId: s.id })),
          skipDuplicates: true,
        });
      }

      return { created: createdStudents, enrolled: toCreate.length + removedRowIds.length };
    });

    return { created: created.length, alreadyExisted: existingStudents.length, enrolled, nameMismatches, errors };
  }

  async listEnrollments(courseId: string, caller: CallerContext) {
    await this.assertOwnsCourse(courseId, caller);
    return this.prisma.enrollment.findMany({
      where: { courseId, deletedAt: null },
      include: { student: true },
    });
  }

  async removeEnrollment(courseId: string, studentId: string, caller: CallerContext) {
    const course = await this.assertOwnsCourse(courseId, caller);

    const enrollment = await this.prisma.enrollment.findFirst({
      where: { courseId, student: { studentId }, deletedAt: null },
      include: { student: { select: { name: true } } },
    });
    if (!enrollment) throw AppException.notFound('Enrollment not found.');

    const hasTakenExam = await this.prisma.examSession.findFirst({
      where: {
        exam: { courseId },
        studentId: enrollment.studentId,
        status: { not: SessionStatus.NOT_STARTED },
      },
    });

    await this.prisma.$transaction(async (tx) => {
      if (hasTakenExam) {
        await tx.enrollment.update({ where: { id: enrollment.id }, data: { deletedAt: new Date() } });
      } else {
        await tx.enrollment.delete({ where: { id: enrollment.id } });
      }
      await this.auditService.log(
        {
          actorId: caller.staffId,
          action: AuditAction.ENROLLMENT_REMOVED,
          entityType: 'Enrollment',
          entityId: enrollment.id,
          metadata: {
            displayName: enrollment.student.name,
            courseName: course.name,
            courseId,
            studentId: enrollment.studentId,
            historyPreserved: Boolean(hasTakenExam),
          },
        },
        tx,
      );
    });
  }

  private async assertOwnsCourse(courseId: string, caller: CallerContext) {
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw AppException.notFound('Course not found.');
    const scopedOrgUnitIds = await this.orgUnitsService.getScopedIds(caller.orgUnitId);
    assertOwnsOrIsAdmin(course.orgUnitId, course.instructorId, caller.staffId, caller.role, scopedOrgUnitIds);
    return course;
  }

  private async assertAssignableInstructor(instructorId: string, orgUnitId: string) {
    const instructor = await this.prisma.staffAccount.findUnique({
      where: { id: instructorId },
      select: { role: true, isActive: true, orgUnitId: true },
    });
    if (!instructor || instructor.role !== StaffRole.INSTRUCTOR || !instructor.isActive) {
      throw AppException.badRequest('Select an active instructor.');
    }
    if (instructor.orgUnitId !== orgUnitId) {
      throw AppException.badRequest('The instructor must belong to the selected unit.');
    }
  }

  private assertCourseActive(status: CourseStatus) {
    if (status === CourseStatus.ARCHIVED) {
      throw AppException.conflict('This course is archived and cannot accept new enrollments.');
    }
  }

  private async lockActiveCourse(tx: Prisma.TransactionClient, courseId: string, staffId: string) {
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "Course" WHERE id = ${courseId} FOR UPDATE`);
    const course = await tx.course.findUnique({ where: { id: courseId }, select: { status: true, instructorId: true } });
    if (!course) throw AppException.notFound('Course not found.');
    if (course.instructorId !== staffId) throw AppException.forbidden();
    if (course.status !== CourseStatus.ACTIVE) this.assertCourseActive(CourseStatus.ARCHIVED);
  }

  private async assertNoOpenActivities(courseId: string, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    const openExam = await db.exam.findFirst({
      where: {
        courseId,
        OR: [
          { status: 'RELEASED' },
          { status: 'DRAFT', scheduledStart: { not: null } },
          { examSessions: { some: { status: SessionStatus.IN_PROGRESS } } },
        ],
      },
      select: { id: true, title: true },
    });
    if (openExam) {
      throw AppException.conflict(
        `Course cannot be archived while exam "${openExam.title}" is scheduled or active. Close or cancel the exam first.`,
      );
    }
  }
}
