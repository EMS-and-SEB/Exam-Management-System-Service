import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class PortalExamsService {
  constructor(private readonly prisma: PrismaService) {}

  async getIncomingExams(studentDirectoryId: string) {
    const [enrollments, cohortMemberships] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: {
          studentId: studentDirectoryId,
          deletedAt: null,
        },
        select: { courseId: true },
      }),
      this.prisma.cohortMember.findMany({
        where: {
          studentId: studentDirectoryId,
          deletedAt: null,
        },
        select: { cohortId: true },
      }),
    ]);

    const courseIds = enrollments.map((e) => e.courseId);
    const cohortIds = cohortMemberships.map((c) => c.cohortId);

    const exams = await this.prisma.exam.findMany({
      where: {
        dataPurgedAt: null,
        status: { not: 'CLOSED' },
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
            instructor: {
              select: {
                name: true,
                email: true,
                role: true,
              },
            },
          },
        },
        cohort: {
          select: {
            name: true,
            coordinator: {
              select: {
                name: true,
                email: true,
                role: true,
              },
            },
          },
        },
      },
      orderBy: { scheduledStart: 'asc' },
    });

    const examIds = exams.map((e) => e.id);

    const rosterEntries = examIds.length > 0
      ? await this.prisma.examRoster.findMany({
          where: {
            studentId: studentDirectoryId,
            examId: { in: examIds },
          },
          select: { examId: true },
        })
      : [];

    const rosterExamIds = new Set(rosterEntries.map((r) => r.examId));

    return exams.map((exam) => {
      const courseOrCohortName = exam.course?.name ?? exam.cohort?.name ?? null;
      const owner = exam.course?.instructor ?? exam.cohort?.coordinator ?? null;

      return {
        id: exam.id,
        title: exam.title,
        examType: exam.examType,
        scheduledStart: exam.scheduledStart,
        durationMinutes: exam.durationMinutes,
        status: exam.status,
        courseOrCohortName,
        owner,
        isOnRoster: rosterExamIds.has(exam.id),
      };
    });
  }
}
