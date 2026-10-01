import { Injectable } from '@nestjs/common';
import { ExamStatus, QuestionType, SessionStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EmailService } from '../../email/email.service.js';
import { AuditService } from '../../audit/audit.service.js';
import { AuditAction } from '../../audit/audit.const.js';
import { AppException } from '../../common/exceptions/app-exceptions.js';
import type { ExamInquiryDto } from '../validation/exam-inquiry.dto.js';

@Injectable()
export class PortalExamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly auditService: AuditService,
  ) {}

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

  /** Completed session statuses — mirrors GradingService terminal set. */
  private static readonly TERMINAL_STATUSES = [
    SessionStatus.SUBMITTED,
    SessionStatus.FORCE_SUBMITTED,
    SessionStatus.EXPIRED,
  ] as const;

  async getExamResults(studentDirectoryId: string) {
    const sessions = await this.prisma.examSession.findMany({
      where: {
        studentId: studentDirectoryId,
        status: { in: [...PortalExamsService.TERMINAL_STATUSES] },
      },
      select: {
        id: true,
        status: true,
        submittedAt: true,
        exam: {
          select: {
            id: true,
            title: true,
            examType: true,
            // Fetch only type + points — never prompt, options, or correctAnswer.
            examQuestions: {
              select: { type: true, points: true },
            },
            course: { select: { name: true } },
            cohort: { select: { name: true } },
          },
        },
        // Fetch only what's needed for grading logic — never responseData.
        answers: {
          select: {
            pointsAwarded: true,
            gradedAt: true,
            examQuestion: { select: { type: true } },
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });

    return sessions.map((session) => {
      const { exam, answers } = session;

      const maxScore = exam.examQuestions.reduce((sum, q) => sum + q.points, 0);
      const contextName = exam.course?.name ?? exam.cohort?.name ?? null;

      // Mirrors the exact condition from GradingService.listExamSessions.
      const needsGrading = answers.some(
        (a) => a.examQuestion.type === QuestionType.WORKOUT && a.gradedAt === null,
      );

      if (needsGrading) {
        return {
          examId: exam.id,
          examTitle: exam.title,
          examType: exam.examType,
          contextName,
          submittedAt: session.submittedAt,
          sessionStatus: session.status,
          status: 'PENDING_GRADING' as const,
          score: null,
          maxScore,
          gradingStatusMessage:
            'Workout questions are currently being graded by your instructor.',
        };
      }

      const score = Number(
        answers.reduce((sum, a) => sum + (a.pointsAwarded ?? 0), 0).toFixed(2),
      );
      const percentage =
        maxScore > 0 ? Number(((score / maxScore) * 100).toFixed(2)) : null;

      return {
        examId: exam.id,
        examTitle: exam.title,
        examType: exam.examType,
        contextName,
        submittedAt: session.submittedAt,
        sessionStatus: session.status,
        status: 'GRADED' as const,
        score,
        maxScore,
        percentage,
      };
    });
  }

  async sendExamInquiry(
    examId: string,
    studentDirectoryId: string,
    dto: ExamInquiryDto,
  ) {
    // Step 1: Load exam with ownership and context in a single query.
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      select: {
        id: true,
        title: true,
        course: {
          select: {
            name: true,
            instructor: { select: { id: true, name: true, email: true } },
          },
        },
        cohort: {
          select: {
            name: true,
            coordinator: { select: { id: true, name: true, email: true } },
          },
        },
        // Only fetch this student's roster row — take:1 stops scanning after first match.
        examRosters: {
          where: { studentId: studentDirectoryId },
          select: { id: true },
          take: 1,
        },
      },
    });

    if (!exam) throw AppException.notFound('Exam not found.');

    // Step 2: Resolve the owner (instructor or coordinator) from the exam context.
    const owner = exam.course?.instructor ?? exam.cohort?.coordinator ?? null;
    const contextName = exam.course?.name ?? exam.cohort?.name ?? 'Unknown';

    if (!owner?.email) {
      throw AppException.badRequest(
        'This exam has no assigned instructor or coordinator to contact.',
      );
    }

    // Step 3: Fetch the student's display details.
    const student = await this.prisma.studentDirectory.findUnique({
      where: { id: studentDirectoryId },
      select: { studentId: true, name: true },
    });
    if (!student) throw AppException.notFound('Student not found.');

    const isOnRoster = exam.examRosters.length > 0;

    // Step 4: Dispatch the email (non-blocking — audit regardless of delivery).
    await this.emailService.sendExamInquiry({
      to: owner.email,
      recipientName: owner.name,
      studentName: student.name,
      studentId: student.studentId,
      examTitle: exam.title,
      courseOrCohortName: contextName,
      isOnRoster,
      subject: dto.subject,
      message: dto.message,
    });

    // Step 5: Audit the inquiry for traceability.
    await this.auditService.log({
      actorId: studentDirectoryId,
      action: AuditAction.STUDENT_EXAM_INQUIRY,
      entityType: 'Exam',
      entityId: examId,
      metadata: {
        recipientId: owner.id,
        recipientEmail: owner.email,
        isOnRoster,
        subject: dto.subject,
      },
    });

    return {
      sent: true,
      recipient: { name: owner.name, email: owner.email },
      sentAt: new Date().toISOString(),
    };
  }
}
