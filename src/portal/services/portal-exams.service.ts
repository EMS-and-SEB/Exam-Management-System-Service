import { Injectable } from '@nestjs/common';
import { ExamStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class PortalExamsService {
  constructor(private readonly prisma: PrismaService) {}

  async getIncomingExams(studentDirectoryId: string) {
    // Step 1: Resolve the student's active course and cohort IDs in parallel.
    const [enrollments, cohortMemberships] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: { studentId: studentDirectoryId, deletedAt: null },
        select: { courseId: true },
      }),
      this.prisma.cohortMember.findMany({
        where: { studentId: studentDirectoryId, deletedAt: null },
        select: { cohortId: true },
      }),
    ]);

    const courseIds = enrollments.map((e) => e.courseId);
    const cohortIds = cohortMemberships.map((m) => m.cohortId);

    // Step 2: Fetch all non-closed, non-purged exams belonging to the student's
    // courses/cohorts OR where the student already has an ExamRoster entry
    // (guards against enrolment changes after the roster was frozen).
    const exams = await this.prisma.exam.findMany({
      where: {
        status: { not: ExamStatus.CLOSED },
        dataPurgedAt: null,
        OR: [
          ...(courseIds.length > 0 ? [{ courseId: { in: courseIds } }] : []),
          ...(cohortIds.length > 0 ? [{ cohortId: { in: cohortIds } }] : []),
          { examRosters: { some: { studentId: studentDirectoryId } } },
        ],
      },
      select: {
        id: true,
        title: true,
        examType: true,
        scheduledStart: true,
        durationMinutes: true,
        status: true,
        course: {
          select: {
            name: true,
            instructor: { select: { name: true, email: true } },
          },
        },
        cohort: {
          select: {
            name: true,
            coordinator: { select: { name: true, email: true } },
          },
        },
        // Only fetch roster entries for this student — avoids loading the full roster.
        examRosters: {
          where: { studentId: studentDirectoryId },
          select: { id: true },
          take: 1,
        },
      },
      orderBy: { scheduledStart: 'asc' },
    });

    // Step 3: Shape the response — never expose questions, OTPs, or answer keys.
    return exams.map((exam) => {
      const isCourseExam = exam.course !== null;
      const ownerName = isCourseExam
        ? exam.course?.instructor?.name ?? null
        : exam.cohort?.coordinator?.name ?? null;
      const ownerEmail = isCourseExam
        ? exam.course?.instructor?.email ?? null
        : exam.cohort?.coordinator?.email ?? null;

      return {
        id: exam.id,
        title: exam.title,
        examType: exam.examType,
        scheduledStart: exam.scheduledStart,
        durationMinutes: exam.durationMinutes,
        status: exam.status,
        context: isCourseExam
          ? { type: 'COURSE' as const, name: exam.course!.name }
          : { type: 'COHORT' as const, name: exam.cohort!.name },
        owner: { name: ownerName, email: ownerEmail },
        isOnRoster: exam.examRosters.length > 0,
      };
    });
  }
}
