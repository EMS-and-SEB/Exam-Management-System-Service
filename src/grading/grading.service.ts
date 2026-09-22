import { Injectable } from '@nestjs/common';
import type { JwtPayload } from '../auth/validation/auth.interface.js';
import { AppException } from '../common/exceptions/app-exceptions.js';
import { ResultsExportService } from '../common/results-export/results-export.service.js';
import { ExamStatus, SessionStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { GradeAnswerDto } from './validation/grading.dto.js';

const TERMINAL_STATUSES: SessionStatus[] = [
  SessionStatus.SUBMITTED,
  SessionStatus.FORCE_SUBMITTED,
  SessionStatus.EXPIRED,
];

@Injectable()
export class GradingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly csv: ResultsExportService,
  ) {}

  // ---------------- OWNERSHIP HELPERS ----------------
  private async loadExamWithOwners(examId: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      include: {
        course: { select: { id: true, instructorId: true, name: true } },
        cohort: { select: { id: true, coordinatorId: true, name: true } },
      },
    });
    if (!exam) throw AppException.notFound('Exam not found.');
    return exam;
  }

  private assertExamOwnership(
    exam: {
      course: { instructorId: string } | null;
      cohort: { coordinatorId: string } | null;
    },
    user: JwtPayload,
  ) {
    const isInstructor = exam.course && exam.course.instructorId === user.sub;
    const isCoordinator = exam.cohort && exam.cohort.coordinatorId === user.sub;
    if (!isInstructor && !isCoordinator) {
      throw AppException.forbidden('You do not own this exam.');
    }
  }

  private assertCourseOwnership(
    course: { instructorId: string } | null,
    user: JwtPayload,
  ) {
    if (!course || course.instructorId !== user.sub) {
      throw AppException.forbidden('You do not own this course.');
    }
  }

  private assertCohortOwnership(
    cohort: { coordinatorId: string } | null,
    user: JwtPayload,
  ) {
    if (!cohort || cohort.coordinatorId !== user.sub) {
      throw AppException.forbidden('You do not own this cohort.');
    }
  }

  async listExamSessions(examId: string, user: JwtPayload) {
    const exam = await this.loadExamWithOwners(examId);
    this.assertExamOwnership(exam, user);

    const sessions = await this.prisma.examSession.findMany({
      where: { examId },
      include: {
        student: { select: { id: true, studentId: true, name: true } },
        answers: { select: { pointsAwarded: true, gradedAt: true, examQuestion: { select: { type: true } } } },
      },
      orderBy: { student: { studentId: 'asc' } },
    });

    const totalPoints = await this.prisma.examQuestion.aggregate({ where: { examId }, _sum: { points: true } });
    const maxScore = totalPoints._sum.points ?? 0;

    return sessions.map((s) => {
      const autoScore = s.answers.filter((a) => a.examQuestion.type !== 'WORKOUT').reduce((sum, a) => sum + (a.pointsAwarded ?? 0), 0);
      const manualScore = s.answers.filter((a) => a.examQuestion.type === 'WORKOUT').reduce((sum, a) => sum + (a.pointsAwarded ?? 0), 0);
      const needsGrading = s.answers.some((a) => a.examQuestion.type === 'WORKOUT' && a.gradedAt === null);

      return {
        id: s.id,
        studentId: s.student.id,
        student: { studentId: s.student.studentId, name: s.student.name },
        status: s.status,
        autoScore,
        manualScore,
        totalScore: autoScore + manualScore,
        maxScore,
        needsGrading,
      };
    });
  }

  async listSessionAnswers(sessionId: string, user: JwtPayload) {
    const session = await this.prisma.examSession.findUnique({
      where: { id: sessionId },
      include: {
        student: { select: { id: true, studentId: true, name: true } },
        exam: {
          include: {
            course: { select: { instructorId: true } },
            cohort: { select: { coordinatorId: true } },
          },
        },
        answers: {
          include: {
            examQuestion: true,
            gradedBy: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!session) throw AppException.notFound('Session not found.');
    this.assertExamOwnership(session.exam, user);

    if (!TERMINAL_STATUSES.includes(session.status)) {
      throw AppException.forbidden(
        'Session is not yet final; answers are not viewable.',
      );
    }

    return {
    session: { id: session.id, studentId: session.studentId, student: session.student },
    answers: session.answers.map((a) => ({
      id: a.id,
      examQuestionId: a.examQuestionId,
      type: a.examQuestion.type,
      prompt: a.examQuestion.prompt,
      points: a.examQuestion.points,
      responseData: a.responseData,
      correctAnswer: a.examQuestion.correctAnswer,
      isCorrect: a.isCorrect,
      pointsAwarded: a.pointsAwarded,
      gradedAt: a.gradedAt,
    })),
  };
  }

  async gradeAnswer(answerId: string, dto: GradeAnswerDto, user: JwtPayload) {
    const answer = await this.prisma.answer.findUnique({
      where: { id: answerId },
      include: {
        examQuestion: true,
        session: {
          include: {
            exam: {
              include: {
                course: { select: { instructorId: true } },
                cohort: { select: { coordinatorId: true } },
              },
            },
          },
        },
      },
    });
    if (!answer) throw AppException.notFound('Answer not found.');
    this.assertExamOwnership(answer.session.exam, user);

    if (!TERMINAL_STATUSES.includes(answer.session.status)) {
      throw AppException.forbidden(
        'Cannot grade answers for a non-terminal session.',
      );
    }

    if (dto.pointsAwarded > answer.examQuestion.points) {
      throw AppException.badRequest(
        `pointsAwarded cannot exceed ${answer.examQuestion.points}.`,
      );
    }

    const updated = await this.prisma.answer.update({
      where: { id: answerId },
      data: {
        pointsAwarded: dto.pointsAwarded,
        gradedById: user.sub,
        gradedAt: new Date(),
        isCorrect: null,
      },
    });

    return {
      answer: {
        id: updated.id,
        pointsAwarded: updated.pointsAwarded,
        gradedById: updated.gradedById,
        gradedAt: updated.gradedAt,
      },
    };
  }

  async exportExamResults(examId: string, user: JwtPayload): Promise<string> {
    const exam = await this.loadExamWithOwners(examId);
    this.assertExamOwnership(exam, user);
    if (exam.status !== ExamStatus.CLOSED) {
      throw AppException.badRequest('Only closed exams have exportable results.');
    }

    const [roster, maxScoreAgg] = await Promise.all([
      this.prisma.examRoster.findMany({
        where: { examId },
        include: {
          student: { select: { id: true, studentId: true, name: true } },
        },
      }),
      this.prisma.examQuestion.aggregate({
        where: { examId },
        _sum: { points: true },
      }),
    ]);
    const maxScore = maxScoreAgg._sum.points ?? 0;

    const sessions = await this.prisma.examSession.findMany({
      where: { examId },
      include: { answers: { select: { pointsAwarded: true } } },
    });
    const sessionsByStudent = new Map(sessions.map((s) => [s.studentId, s]));

    const rows = roster.map((r) => {
      const s = sessionsByStudent.get(r.student.id);
      const score =
        s?.answers.reduce((sum, a) => sum + (a.pointsAwarded ?? 0), 0) ?? 0;
      return [
        r.student.studentId,
        r.student.name,
        s && s.status !== SessionStatus.NOT_STARTED ? score : '-',
      ];
    });

    return this.csv.buildCsv(
      ['studentId', 'name', `${exam.title}(${maxScore})`],
      rows,
    );
  }

  async courseResults(courseId: string, user: JwtPayload) {
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw AppException.notFound('Course not found.');
    this.assertCourseOwnership(course, user);

    const exams = await this.prisma.exam.findMany({ where: { courseId, status: 'CLOSED' } });
    const examIds = exams.map((e) => e.id);

    const maxScoreRows = await this.prisma.examQuestion.groupBy({
      by: ['examId'],
      where: { examId: { in: examIds } },
      _sum: { points: true },
    });
    const maxScoreByExam = new Map(maxScoreRows.map((r) => [r.examId, r._sum.points ?? 0]));

    const enrollments = await this.prisma.enrollment.findMany({
      where: { courseId },
      include: { student: { select: { id: true, studentId: true, name: true } } },
    });
    const studentIds = enrollments.map((e) => e.student.id);

    const sessions = await this.prisma.examSession.findMany({
      where: { examId: { in: examIds }, studentId: { in: studentIds } },
      include: { answers: { select: { pointsAwarded: true } } },
    });
    const sessionsByKey = new Map(sessions.map((s) => [`${s.studentId}:${s.examId}`, s]));

    return enrollments.map((enrollment) => {
      const scores: Record<string, { score: number; maxScore: number } | null> = {};
      let totalScore = 0;

      for (const exam of exams) {
        const session = sessionsByKey.get(`${enrollment.student.id}:${exam.id}`);
        const maxScore = maxScoreByExam.get(exam.id) ?? 0;

        if (session && session.status !== SessionStatus.NOT_STARTED) {
          const score = session.answers.reduce((sum, a) => sum + (a.pointsAwarded ?? 0), 0);
          scores[exam.id] = { score, maxScore };
          totalScore += score;
        } else {
          scores[exam.id] = null;
        }
      }

      return {
        studentId: enrollment.student.studentId,
        name: enrollment.student.name,
        scores,
        aggregate: totalScore,
      };
    });
  }
  async exportCourseResults(courseId: string, user: JwtPayload) {
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw AppException.notFound('Course not found.');
    this.assertCourseOwnership(course, user);

    const exams = await this.prisma.exam.findMany({
      where: { courseId, status: ExamStatus.CLOSED },
      orderBy: { createdAt: 'asc' },
    });
    const examIds = exams.map((e) => e.id);

    const maxScoreRows = await this.prisma.examQuestion.groupBy({
      by: ['examId'],
      where: { examId: { in: examIds } },
      _sum: { points: true },
    });
    const maxScoreByExam = new Map(maxScoreRows.map((r) => [r.examId, r._sum.points ?? 0]));

    const enrollments = await this.prisma.enrollment.findMany({
      where: { courseId },
      include: { student: { select: { id: true, studentId: true, name: true } } },
    });
    const studentIds = enrollments.map((e) => e.student.id);

    const rosterRows = await this.prisma.examRoster.findMany({
      where: { examId: { in: examIds }, studentId: { in: studentIds } },
    });
    const rosterSet = new Set(rosterRows.map((r) => `${r.studentId}:${r.examId}`));

    const sessions = await this.prisma.examSession.findMany({
      where: { examId: { in: examIds }, studentId: { in: studentIds } },
      include: { answers: { select: { pointsAwarded: true } } },
    });
    const sessionsByKey = new Map(sessions.map((s) => [`${s.studentId}:${s.examId}`, s]));

    const headers = ['studentId', 'name', ...exams.map((e) => `${e.title}(${maxScoreByExam.get(e.id) ?? 0})`)];

    const rows: (string | number)[][] = enrollments.map((enr) => {
      const row: (string | number)[] = [enr.student.studentId, enr.student.name];
      for (const exam of exams) {
        const key = `${enr.student.id}:${exam.id}`;
        if (!rosterSet.has(key)) {
          row.push('-');
          continue;
        }
        const session = sessionsByKey.get(key);
        if (!session || session.status === SessionStatus.NOT_STARTED) {
          row.push('-');
          continue;
        }
        const score = session?.answers.reduce((sum, a) => sum + (a.pointsAwarded ?? 0), 0) ?? 0;
        row.push(score);
      }
      return row;
    });

    return this.csv.buildCsv(headers, rows);
  }

 async cohortResults(cohortId: string, user: JwtPayload) {
    const cohort = await this.prisma.cohort.findUnique({ where: { id: cohortId } });
    if (!cohort) throw AppException.notFound('Cohort not found.');
    this.assertCohortOwnership(cohort, user);

    const exams = await this.prisma.exam.findMany({ where: { cohortId, status: 'CLOSED' } });
    const examIds = exams.map((e) => e.id);

    const maxScoreRows = await this.prisma.examQuestion.groupBy({
      by: ['examId'],
      where: { examId: { in: examIds } },
      _sum: { points: true },
    });
    const maxScoreByExam = new Map(maxScoreRows.map((r) => [r.examId, r._sum.points ?? 0]));

    const members = await this.prisma.cohortMember.findMany({
      where: { cohortId },
      include: { student: { select: { id: true, studentId: true, name: true } } },
    });
    const studentIds = members.map((m) => m.student.id);

    const sessions = await this.prisma.examSession.findMany({
      where: { examId: { in: examIds }, studentId: { in: studentIds } },
      include: { answers: { select: { pointsAwarded: true } } },
    });
    const sessionsByKey = new Map(sessions.map((s) => [`${s.studentId}:${s.examId}`, s]));

    return members.map((m) => {
      const scores: Record<string, { score: number; maxScore: number } | null> = {};
      let totalScore = 0;

      for (const exam of exams) {
        const session = sessionsByKey.get(`${m.student.id}:${exam.id}`);
        const maxScore = maxScoreByExam.get(exam.id) ?? 0;

        if (session && session.status !== SessionStatus.NOT_STARTED) {
          const score = session.answers.reduce((sum, a) => sum + (a.pointsAwarded ?? 0), 0);
          scores[exam.id] = { score, maxScore };
          totalScore += score;
        } else {
          scores[exam.id] = null;
        }
      }

      return {
        studentId: m.student.studentId,
        name: m.student.name,
        scores,
        aggregate: totalScore,
      };
    });
  }

  async exportCohortResults(cohortId: string, user: JwtPayload): Promise<string> {
    const cohort = await this.prisma.cohort.findUnique({ where: { id: cohortId } });
    if (!cohort) throw AppException.notFound('Cohort not found.');
    this.assertCohortOwnership(cohort, user);

    const exams = await this.prisma.exam.findMany({
      where: { cohortId, status: ExamStatus.CLOSED },
      orderBy: { createdAt: 'asc' },
    });
    const examIds = exams.map((e) => e.id);

    const maxScoreRows = await this.prisma.examQuestion.groupBy({
      by: ['examId'],
      where: { examId: { in: examIds } },
      _sum: { points: true },
    });
    const maxByExam = new Map(maxScoreRows.map((r) => [r.examId, r._sum.points ?? 0]));

    const members = await this.prisma.cohortMember.findMany({
      where: { cohortId },
      include: { student: { select: { id: true, studentId: true, name: true } } },
    });
    const studentIds = members.map((m) => m.student.id);

    const sessions = await this.prisma.examSession.findMany({
      where: { examId: { in: examIds }, studentId: { in: studentIds } },
      include: { answers: { select: { pointsAwarded: true } } },
    });
    const sessionsByKey = new Map(sessions.map((s) => [`${s.studentId}:${s.examId}`, s]));

    const headers = ['studentId', 'name', ...exams.map((e) => `${e.title}(${maxByExam.get(e.id) ?? 0})`)];

    const rows: (string | number)[][] = members.map((m) => {
      const row: (string | number)[] = [m.student.studentId, m.student.name];
      for (const exam of exams) {
        const session = sessionsByKey.get(`${m.student.id}:${exam.id}`);
        if (!session || session.status === SessionStatus.NOT_STARTED) {
          row.push('-');
          continue;
        }
        const score = session?.answers.reduce((sum, a) => sum + (a.pointsAwarded ?? 0), 0) ?? 0;
        row.push(score);
      }
      return row;
    });

    return this.csv.buildCsv(headers, rows);
  }
}
