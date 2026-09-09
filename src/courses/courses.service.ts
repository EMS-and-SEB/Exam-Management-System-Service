import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { StudentsService } from '../students/students.service.js';
import { AppException } from '../common/exceptions/app-exceptions.js';
import { buildOwnerScopeWhere, assertOwnsOrIsAdmin } from '../common/utils/ownership.util.js';
import { parseRosterCsv } from '../common/utils/csv-parser.util.js';
import { StaffRole, CourseStatus } from '../generated/prisma/client.js';

interface CallerContext {
  staffId: string;
  role: StaffRole;
}

@Injectable()
export class CoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly studentsService: StudentsService,
  ) {}

  create(name: string, instructorId: string) {
    return this.prisma.course.create({ data: { name, instructorId } });
  }

  findAll(caller: CallerContext) {
    return this.prisma.course.findMany({
      where: buildOwnerScopeWhere(caller.role, caller.staffId, 'instructorId'),
    });
  }

  async findOne(id: string, caller: CallerContext) {
    const course = await this.assertOwnsCourse(id, caller);
    return course;
  }

  async update(id: string, data: { name?: string; instructorId?: string; status?: CourseStatus }) {
    const course = await this.prisma.course.findUnique({ where: { id } });
    if (!course) throw AppException.notFound('Course not found.');
    return this.prisma.course.update({ where: { id }, data });
  }

  async enrollOne(courseId: string, studentId: string, name: string, caller: CallerContext) {
    await this.assertOwnsCourse(courseId, caller);
    const student = await this.studentsService.findOrCreateByStudentId(studentId, name);
    const enrollment = await this.prisma.enrollment.create({
      data: { courseId, studentId: student.id },
    });
    return { enrollment };
  }

  async enrollSelected(courseId: string, studentIds: string[], caller: CallerContext) {
    await this.assertOwnsCourse(courseId, caller);

    const uniqueIds = [...new Set(studentIds)];

    const existing = await this.prisma.enrollment.findMany({
      where: { courseId, studentId: { in: uniqueIds }, deletedAt: null },
      select: { studentId: true },
    });
    const existingSet = new Set(existing.map((e) => e.studentId));
    const toEnroll = uniqueIds.filter((id) => !existingSet.has(id));

    if (toEnroll.length > 0) {
      await this.prisma.enrollment.createMany({
        data: toEnroll.map((studentId) => ({ courseId, studentId })),
        skipDuplicates: true,
      });
    }

    return { enrolled: toEnroll.length, alreadyEnrolled: existingSet.size };
  }

  async enrollBulk(courseId: string, file: Express.Multer.File, caller: CallerContext) {
    await this.assertOwnsCourse(courseId, caller);
    const { rows, errors } = parseRosterCsv(file.buffer);
    if (rows.length === 0) return { created: 0, alreadyExisted: 0, enrolled: 0, errors };

    const studentIds = [...new Set(rows.map((r) => r.studentId))];

    const existingStudents = await this.prisma.studentDirectory.findMany({
      where: { studentId: { in: studentIds } },
    });
    const knownIds = new Set(existingStudents.map((s) => s.studentId));
    const newRows = [...new Map(
      rows.filter((r) => !knownIds.has(r.studentId)).map((r) => [r.studentId, r]),
    ).values()];

    const existingEnrollments = await this.prisma.enrollment.findMany({
      where: { courseId, deletedAt: null },
      select: { studentId: true },
    });
    const alreadyEnrolledSet = new Set(existingEnrollments.map((e) => e.studentId));

    const [newlyCreated, toEnroll] = await this.prisma.$transaction(async (tx) => {
      const created = newRows.length > 0
        ? await tx.studentDirectory.createManyAndReturn({
            data: newRows.map((r) => ({ studentId: r.studentId, name: r.name })),
            skipDuplicates: true,
          })
        : [];

      const allStudents = [...existingStudents, ...created];
      const toEnrollList = allStudents.filter((s) => !alreadyEnrolledSet.has(s.id));

      if (toEnrollList.length > 0) {
        await tx.enrollment.createMany({
          data: toEnrollList.map((s) => ({ courseId, studentId: s.id })),
          skipDuplicates: true,
        });
      }

      return [created, toEnrollList];
    });

    return { created: newRows.length, alreadyExisted: existingStudents.length, enrolled: toEnroll.length, errors };
  }
  async listEnrollments(courseId: string, caller: CallerContext) {
    await this.assertOwnsCourse(courseId, caller);
    return this.prisma.enrollment.findMany({
      where: { courseId, deletedAt: null },
      include: { student: true },
    });
  }

  async removeEnrollment(courseId: string, studentId: string, caller: CallerContext) {
    await this.assertOwnsCourse(courseId, caller);

    const enrollment = await this.prisma.enrollment.findFirst({
      where: { courseId, studentId, deletedAt: null },
    });
    if (!enrollment) throw AppException.notFound('Enrollment not found.');

    const hasTakenExam = await this.prisma.examSession.findFirst({
      where: { exam: { courseId }, studentId },
    });

    if (hasTakenExam) {
      await this.prisma.enrollment.update({ where: { id: enrollment.id }, data: { deletedAt: new Date() } });
    } else {
      await this.prisma.enrollment.delete({ where: { id: enrollment.id } });
    }
  }

  private async assertOwnsCourse(courseId: string, caller: CallerContext) {
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw AppException.notFound('Course not found.');
    assertOwnsOrIsAdmin(course.instructorId, caller.staffId, caller.role);
    return course;
  }
}