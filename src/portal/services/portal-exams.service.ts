import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EmailService } from '../../email/email.service.js';
import { AppException } from '../../common/exceptions/app-exceptions.js';
import type { ExamInquiryDto } from '../validation/exam-inquiry.dto.js';

@Injectable()
export class PortalExamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

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

  async getExamResults(studentDirectoryId: string) {
    const sessions = await this.prisma.examSession.findMany({
      where: {
        studentId: studentDirectoryId,
        status: { in: ['SUBMITTED', 'FORCE_SUBMITTED', 'EXPIRED'] },
      },
      include: {
        exam: {
          include: {
            course: { select: { name: true } },
            cohort: { select: { name: true } },
            examQuestions: {
              select: {
                id: true,
                points: true,
                type: true,
              },
            },
          },
        },
        answers: {
          include: {
            examQuestion: {
              select: {
                type: true,
              },
            },
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });

    return sessions.map((session) => {
      const { exam, answers } = session;
      const courseOrCohortName = exam.course?.name ?? exam.cohort?.name ?? null;
      const maxScore = exam.examQuestions.reduce((sum, q) => sum + q.points, 0);

      const hasUngradedWorkout = answers.some(
        (a) => a.examQuestion.type === 'WORKOUT' && a.gradedAt === null,
      );

      if (hasUngradedWorkout) {
        return {
          examId: exam.id,
          examTitle: exam.title,
          courseOrCohortName,
          submittedAt: session.submittedAt,
          status: 'PENDING_GRADING' as const,
          score: null,
          maxScore,
          percentage: null,
          notice: 'Workout questions are currently being graded by your instructor.',
        };
      }

      const score = answers.reduce((sum, a) => sum + (a.pointsAwarded ?? 0), 0);
      const percentage = maxScore > 0 ? (score / maxScore) * 100 : 0;

      return {
        examId: exam.id,
        examTitle: exam.title,
        courseOrCohortName,
        submittedAt: session.submittedAt,
        status: 'GRADED' as const,
        score,
        maxScore,
        percentage,
      };
    });
  }

  async sendExamInquiry(examId: string, studentDirectoryId: string, dto: ExamInquiryDto) {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      include: {
        course: {
          include: {
            instructor: true,
          },
        },
        cohort: {
          include: {
            coordinator: true,
          },
        },
      },
    });

    if (!exam) {
      throw AppException.notFound('Exam not found.');
    }

    const recipient = exam.course?.instructor ?? exam.cohort?.coordinator;
    if (!recipient?.email) {
      throw AppException.badRequest('No instructor or coordinator found for this exam.');
    }

    const student = await this.prisma.studentDirectory.findUnique({
      where: { id: studentDirectoryId },
    });

    if (!student) {
      throw AppException.notFound('Student not found.');
    }

    const rosterEntry = await this.prisma.examRoster.findUnique({
      where: {
        examId_studentId: {
          examId,
          studentId: studentDirectoryId,
        },
      },
    });

    const courseOrCohortName = exam.course?.name ?? exam.cohort?.name ?? 'Unknown';

    await this.emailService.sendExamInquiry({
      to: recipient.email,
      recipientName: recipient.name,
      studentName: student.name,
      studentId: student.studentId,
      examTitle: exam.title,
      courseOrCohortName,
      isOnRoster: !!rosterEntry,
      subject: dto.subject,
      message: dto.message,
    });

    return {
      sent: true,
      recipient: {
        name: recipient.name,
        email: recipient.email,
      },
      sentAt: new Date(),
    };
  }
}
