import { Injectable } from '@nestjs/common';
import type { JwtPayload } from '../auth/validation/auth.interface.js';
import { AppException } from '../common/exceptions/app-exceptions.js';
import { ResultsExportService } from '../common/results-export/results-export.service.js';
import { SessionStatus } from '../generated/prisma/client.js';
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

  // ---------------- LIST EXAM SESSIONS ----------------
  async listExamSessions(examId: string, user: JwtPayload) {
    const exam = await this.loadExamWithOwners(examId);
    this.assertExamOwnership(exam, user);

    const sessions = await this.prisma.examSession.findMany({
      where: { examId },
      include: {
        student: { select: { id: true, studentId: true, name: true } },
        answers: { select: { pointsAwarded: true } },
        incidents: true,
      },
      orderBy: { student: { studentId: 'asc' } },
    });

    const totalPoints = await this.prisma.examQuestion.aggregate({
      where: { examId },
      _sum: { points: true },
    });
    const maxScore = totalPoints._sum.points ?? 0;

    return {
      examId,
      maxScore,
      sessions: sessions.map((s) => ({
        id: s.id,
        student: s.student,
        status: s.status,
        startedAt: s.startedAt,
        endsAt: s.endsAt,
        submittedAt: s.submittedAt,
        lastPolledAt: s.lastPolledAt,
        score: s.answers.reduce((sum, a) => sum + (a.pointsAwarded ?? 0), 0),
        incidents: s.incidents,
      })),
    };
  }

  // ---------------- SESSION ANSWERS ----------------
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
      sessionId,
      student: session.student,
      status: session.status,
      submittedAt: session.submittedAt,
      answers: session.answers.map((a) => ({
        id: a.id,
        examQuestionId: a.examQuestionId,
        prompt: a.examQuestion.prompt,
        type: a.examQuestion.type,
        options: a.examQuestion.options,
        correctAnswer: a.examQuestion.correctAnswer,
        points: a.examQuestion.points,
        responseData: a.responseData,
        isCorrect: a.isCorrect,
        pointsAwarded: a.pointsAwarded,
        gradedBy: a.gradedBy,
        gradedAt: a.gradedAt,
      })),
    };
  }

  // ---------------- GRADE AN ANSWER ----------------
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

  // ---------------- EXPORTS ----------------
  async exportExamResults(examId: string, user: JwtPayload): Promise<string> {
    const exam = await this.loadExamWithOwners(examId);
    this.assertExamOwnership(exam, user);

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
      return [r.student.studentId, r.student.name, s ? score : '', maxScore];
    });

    return this.csv.buildCsv(['studentId', 'name', 'score', 'maxScore'], rows);
  }

  async exportCourseResults(courseId: string, user: JwtPayload) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
    });
    if (!course) throw AppException.notFound('Course not found.');
    this.assertCourseOwnership(course, user);

    const exams = await this.prisma.exam.findMany({
      where: { courseId },
      orderBy: { createdAt: 'asc' },
    });

    const examColumns = exams.map((e) => e.title);
    const maxScoreByExam = new Map<string, number>();
    for (const e of exams) {
      const agg = await this.prisma.examQuestion.aggregate({
        where: { examId: e.id },
        _sum: { points: true },
      });
      maxScoreByExam.set(e.id, agg._sum.points ?? 0);
    }

    const enrollments = await this.prisma.enrollment.findMany({
      where: { courseId, deletedAt: null },
      include: {
        student: { select: { id: true, studentId: true, name: true } },
      },
    });

    const headers = [
      'studentId',
      'name',
      ...examColumns.flatMap((t) => [`${t} (score)`, `${t} (max)`]),
    ];

    const rows: (string | number)[][] = [];
    for (const enr of enrollments) {
      const row: (string | number)[] = [
        enr.student.studentId,
        enr.student.name,
      ];
      for (const e of exams) {
        const roster = await this.prisma.examRoster.findUnique({
          where: {
            examId_studentId: { examId: e.id, studentId: enr.student.id },
          },
        });
        if (!roster) {
          row.push('--', '--');
          continue;
        }
        const session = await this.prisma.examSession.findUnique({
          where: {
            examId_studentId: { examId: e.id, studentId: enr.student.id },
          },
          include: { answers: { select: { pointsAwarded: true } } },
        });
        const score =
          session?.answers.reduce(
            (sum, a) => sum + (a.pointsAwarded ?? 0),
            0,
          ) ?? 0;
        row.push(score, maxScoreByExam.get(e.id) ?? 0);
      }
      rows.push(row);
    }

    return this.csv.buildCsv(headers, rows);
  }

  async cohortResults(cohortId: string, user: JwtPayload) {
    const cohort = await this.prisma.cohort.findUnique({
      where: { id: cohortId },
    });
    if (!cohort) throw AppException.notFound('Cohort not found.');
    this.assertCohortOwnership(cohort, user);

    const exams = await this.prisma.exam.findMany({
      where: { cohortId },
    });
    const maxScoreByExam = new Map<string, number>();
    for (const e of exams) {
      const agg = await this.prisma.examQuestion.aggregate({
        where: { examId: e.id },
        _sum: { points: true },
      });
      maxScoreByExam.set(e.id, agg._sum.points ?? 0);
    }

    const members = await this.prisma.cohortMember.findMany({
      where: { cohortId },
      include: {
        student: { select: { id: true, studentId: true, name: true } },
      },
    });

    const results = await Promise.all(
      members.map(async (m) => {
        const examResults = await Promise.all(
          exams.map(async (e) => {
            const session = await this.prisma.examSession.findUnique({
              where: {
                examId_studentId: {
                  examId: e.id,
                  studentId: m.student.id,
                },
              },
              include: { answers: { select: { pointsAwarded: true } } },
            });
            const score =
              session?.answers.reduce(
                (sum, a) => sum + (a.pointsAwarded ?? 0),
                0,
              ) ?? 0;
            return {
              examId: e.id,
              examTitle: e.title,
              score,
              maxScore: maxScoreByExam.get(e.id) ?? 0,
            };
          }),
        );
        return {
          student: m.student,
          exams: examResults,
        };
      }),
    );

    return { cohortId, results };
  }

  async exportCohortResults(
    cohortId: string,
    user: JwtPayload,
  ): Promise<string> {
    const cohort = await this.prisma.cohort.findUnique({
      where: { id: cohortId },
    });
    if (!cohort) throw AppException.notFound('Cohort not found.');
    this.assertCohortOwnership(cohort, user);

    const exams = await this.prisma.exam.findMany({
      where: { cohortId },
      orderBy: { createdAt: 'asc' },
    });
    const maxByExam = new Map<string, number>();
    for (const e of exams) {
      const agg = await this.prisma.examQuestion.aggregate({
        where: { examId: e.id },
        _sum: { points: true },
      });
      maxByExam.set(e.id, agg._sum.points ?? 0);
    }

    const members = await this.prisma.cohortMember.findMany({
      where: { cohortId },
      include: {
        student: { select: { id: true, studentId: true, name: true } },
      },
    });

    const headers = [
      'studentId',
      'name',
      ...exams.flatMap((e) => [`${e.title} (score)`, `${e.title} (max)`]),
    ];

    const rows: (string | number)[][] = [];
    for (const m of members) {
      const row: (string | number)[] = [m.student.studentId, m.student.name];
      for (const e of exams) {
        const session = await this.prisma.examSession.findUnique({
          where: {
            examId_studentId: { examId: e.id, studentId: m.student.id },
          },
          include: { answers: { select: { pointsAwarded: true } } },
        });
        const score =
          session?.answers.reduce(
            (sum, a) => sum + (a.pointsAwarded ?? 0),
            0,
          ) ?? 0;
        row.push(score, maxByExam.get(e.id) ?? 0);
      }
      rows.push(row);
    }

    return this.csv.buildCsv(headers, rows);
  }
}
