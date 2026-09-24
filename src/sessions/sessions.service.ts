import { Injectable } from '@nestjs/common';
import { AppException } from '../common/exceptions/app-exceptions.js';
import {
  ExamStatus,
  Prisma,
  QuestionType,
  SessionStatus,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  SaveAnswerDto,
  StudentLoginDto,
} from './validation/sessions.dto.js';
// import { JwtService } from '@nestjs/jwt';
// import { ConfigService } from '@nestjs/config';

const AUTO_GRADED_TYPES: QuestionType[] = [
  QuestionType.TRUE_FALSE,
  QuestionType.MULTIPLE_CHOICE,
  QuestionType.MULTIPLE_SELECT,
  QuestionType.MATCHING,
  QuestionType.FILL_BLANK,
];

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    // private readonly jwtService: JwtService,
    // private readonly configService: ConfigService,
  ) {}

  // ---------------- LOGIN ----------------
  async studentLogin(dto: StudentLoginDto) {
    // try {
    //   this.jwtService.verify(dto.handshakeToken, {
    //     secret: this.configService.getOrThrow<string>('seb.handshakeSecret'),
    //   });
    // } catch {
    //   throw AppException.unauthorized('A valid SEB handshake is required to log in.');
    // }

    const otp = await this.prisma.examOTP.findFirst({
      where: { code: dto.otp },
    });
    if (!otp) throw AppException.unauthorized('Invalid or expired OTP.');

    const exam = await this.prisma.exam.findUnique({
      where: { id: otp.examId },
    });
    if (!exam || exam.status !== ExamStatus.RELEASED) {
      throw AppException.unauthorized('Exam is not available for login.');
    }

    const now = new Date();
    if (!exam.scheduledStart || !exam.durationMinutes) {
      throw AppException.unauthorized('Exam is not fully configured.');
    }
    if (now < exam.scheduledStart) {
      throw AppException.unauthorized('Exam has not started yet.');
    }
    if (now > otp.expiresAt) {
      throw AppException.unauthorized('Login window has expired.');
    }

    const student = await this.prisma.studentDirectory.findUnique({
      where: { studentId: dto.studentId },
    });
    if (!student) throw AppException.unauthorized('Student not found.');

    const roster = await this.prisma.examRoster.findUnique({
      where: {
        examId_studentId: { examId: exam.id, studentId: student.id },
      },
    });
    if (!roster) {
      throw AppException.unauthorized('You are not on this exam roster.');
    }

    const existing = await this.prisma.examSession.findUnique({
      where: {
        examId_studentId: { examId: exam.id, studentId: student.id },
      },
    });
    if (existing) {
      throw AppException.conflict(
        'A session already exists for this student on this exam.',
      );
    }

    const examQuestions = await this.prisma.examQuestion.findMany({
      where: { examId: exam.id },
      orderBy: { order: 'asc' },
    });

    const questionOrder = this.shuffle(examQuestions.map((q) => q.id));
    const optionOrder = this.buildOptionOrder(examQuestions);

    const endsAt = new Date(now.getTime() + exam.durationMinutes * 60_000);

    const session = await this.prisma.examSession.create({
      data: {
        examId: exam.id,
        studentId: student.id,
        status: SessionStatus.IN_PROGRESS,
        startedAt: now,
        endsAt,
        questionOrder: questionOrder as Prisma.InputJsonValue,
        optionOrder: optionOrder as unknown as Prisma.InputJsonValue,
        lastPolledAt: now,
      },
    });

    const safeQuestions = questionOrder.map((id) => {
      const q = examQuestions.find((x) => x.id === id)!;
      const { correctAnswer: _omit, ...safe } = q;
      return { ...safe, options: this.applyOptionOrder(q, optionOrder) };
    });

    return {
      sessionToken: session.id,
      exam: { id: exam.id, title: exam.title, examType: exam.examType },
      endsAt: session.endsAt,
      examQuestions: safeQuestions,
      student: { name: student.name, studentId: student.studentId },
    };
  }

  // ---------------- POLL ----------------
  async getSession(id: string) {
    let session = await this.prisma.examSession.findUnique({ where: { id } });
    if (!session) throw AppException.notFound('Session not found.');

    const now = new Date();
    if (
      session.status === SessionStatus.IN_PROGRESS &&
      session.endsAt &&
      now >= session.endsAt
    ) {
      const hasAnswers = await this.prisma.answer.count({
        where: { sessionId: session.id },
      });
      const newStatus =
        hasAnswers > 0 ? SessionStatus.SUBMITTED : SessionStatus.EXPIRED;
      if (newStatus === SessionStatus.SUBMITTED) {
        await this.gradeAutoAnswers(session.id);
      }
      session = await this.prisma.examSession.update({
        where: { id: session.id },
        data: { status: newStatus, submittedAt: now },
      });
    }

    await this.prisma.examSession.update({
      where: { id },
      data: { lastPolledAt: now },
    });

    if (
      session.status !== SessionStatus.IN_PROGRESS &&
      session.status !== SessionStatus.NOT_STARTED
    ) {
      const summary = await this.computeSummary(session.id, session.examId);
      return {
        status: session.status,
        submittedAt: session.submittedAt,
        ...summary,
      };
    }

    const questions = await this.getSessionQuestions(session);
    return {
      status: session.status,
      endsAt: session.endsAt,
      questions,
    };
  }

  // ---------------- AUTOSAVE ----------------
  async saveAnswer(id: string, dto: SaveAnswerDto) {
    const session = await this.prisma.examSession.findUnique({
      where: { id },
    });
    if (!session) throw AppException.notFound('Session not found.');
    if (session.status !== SessionStatus.IN_PROGRESS) {
      throw AppException.forbidden('Session is not accepting answers.');
    }

    const unresolvedIncident = await this.prisma.incident.findFirst({
      where: { sessionId: id, resolvedAt: null },
    });
    if (unresolvedIncident) {
      throw AppException.forbidden(
        'Session is locked out due to an unresolved incident.',
      );
    }

    const eq = await this.prisma.examQuestion.findUnique({
      where: { id: dto.examQuestionId },
    });
    if (!eq || eq.examId !== session.examId) {
      throw AppException.badRequest(
        'This question does not belong to the session exam.',
      );
    }

    await this.prisma.answer.upsert({
      where: {
        sessionId_examQuestionId: {
          sessionId: id,
          examQuestionId: dto.examQuestionId,
        },
      },
      create: {
        sessionId: id,
        examQuestionId: dto.examQuestionId,
        responseData: dto.responseData,
      },
      update: { responseData: dto.responseData },
    });

    await this.prisma.examSession.update({
      where: { id },
      data: { lastPolledAt: new Date() },
    });

    return { saved: true };
  }

  // ---------------- SUBMIT ----------------
  async submit(id: string) {
    const session = await this.prisma.examSession.findUnique({
      where: { id },
    });
    if (!session) throw AppException.notFound('Session not found.');

    if (
      session.status === SessionStatus.SUBMITTED ||
      session.status === SessionStatus.FORCE_SUBMITTED ||
      session.status === SessionStatus.EXPIRED
    ) {
      const summary = await this.computeSummary(session.id, session.examId);
      return {
        status: session.status,
        submittedAt: session.submittedAt,
        ...summary,
      };
    }

    const hasAnswers = await this.prisma.answer.count({
      where: { sessionId: id },
    });
    const newStatus =
      hasAnswers > 0 ? SessionStatus.SUBMITTED : SessionStatus.EXPIRED;

    if (newStatus === SessionStatus.SUBMITTED) {
      await this.gradeAutoAnswers(session.id);
    }

    const updated = await this.prisma.examSession.update({
      where: { id },
      data: { status: newStatus, submittedAt: new Date() },
    });

    const summary = await this.computeSummary(updated.id, updated.examId);
    return {
      status: updated.status,
      submittedAt: updated.submittedAt,
      ...summary,
    };
  }

  // ---------------- HELPERS ----------------
  private async getSessionQuestions(session: {
    examId: string;
    questionOrder: unknown;
    optionOrder: unknown;
  }) {
    const examQuestions = await this.prisma.examQuestion.findMany({
      where: { examId: session.examId },
    });

    const order = (session.questionOrder as string[] | null) ?? [];
    const optionOrder = (session.optionOrder as Record<string, unknown>) ?? {};

    const ordered = order
      .map((qid) => examQuestions.find((q) => q.id === qid))
      .filter((q): q is NonNullable<typeof q> => Boolean(q));

    return ordered.map((q) => {
      const { correctAnswer: _omit, ...safe } = q;
      return { ...safe, options: this.applyOptionOrder(q, optionOrder) };
    });
  }

  private shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  private buildOptionOrder(
    questions: { id: string; type: QuestionType; options: unknown }[],
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const q of questions) {
      if (!q.options) continue;
      if (
        q.type === QuestionType.MULTIPLE_CHOICE ||
        q.type === QuestionType.MULTIPLE_SELECT
      ) {
        const ids = (q.options as { id: string }[]).map((o) => o.id);
        result[q.id] = this.shuffle(ids);
      } else if (q.type === QuestionType.MATCHING) {
        const opts = q.options as {
          left?: { id: string }[];
          right?: { id: string }[];
        };
        result[q.id] = {
          left: this.shuffle((opts.left ?? []).map((o) => o.id)),
          right: this.shuffle((opts.right ?? []).map((o) => o.id)),
        };
      }
    }
    return result;
  }

  private applyOptionOrder(
    q: { id: string; type: QuestionType; options: unknown },
    optionOrder: Record<string, unknown>,
  ): unknown {
    const order = optionOrder[q.id];
    if (!order) return q.options;
    if (
      q.type === QuestionType.MULTIPLE_CHOICE ||
      q.type === QuestionType.MULTIPLE_SELECT
    ) {
      const byId = new Map(
        (q.options as { id: string }[]).map((o) => [o.id, o]),
      );
      return (order as string[]).map((id) => byId.get(id)).filter(Boolean);
    }
    if (q.type === QuestionType.MATCHING) {
      const opts = q.options as {
        left?: { id: string }[];
        right?: { id: string }[];
      };
      const leftById = new Map((opts.left ?? []).map((o) => [o.id, o]));
      const rightById = new Map((opts.right ?? []).map((o) => [o.id, o]));
      const ord = order as { left: string[]; right: string[] };
      return {
        left: ord.left.map((id) => leftById.get(id)).filter(Boolean),
        right: ord.right.map((id) => rightById.get(id)).filter(Boolean),
      };
    }
    return q.options;
  }

  private async gradeAutoAnswers(sessionId: string) {
    const answers = await this.prisma.answer.findMany({
      where: { sessionId },
      include: { examQuestion: true },
    });

    for (const ans of answers) {
      const q = ans.examQuestion;
      if (!AUTO_GRADED_TYPES.includes(q.type)) continue;
      if (!q.correctAnswer) continue;
      const scoreRatio = this.getScoreRatio(
        q.type,
        q.correctAnswer,
        ans.responseData,
      );
      const isCorrect = this.isFullyCorrectAnswer(
        q.type,
        q.correctAnswer,
        ans.responseData,
      );
      const pointsAwarded = q.points * scoreRatio;
      await this.prisma.answer.update({
        where: { id: ans.id },
        data: { isCorrect, pointsAwarded },
      });
    }
  }

  private getScoreRatio(
    type: QuestionType,
    correct: unknown,
    response: unknown,
  ): number {
    if (response === null || response === undefined) return 0;
    switch (type) {
      case QuestionType.TRUE_FALSE:
      case QuestionType.MULTIPLE_CHOICE:
        return correct === response ? 1 : 0;
      case QuestionType.MULTIPLE_SELECT: {
        const c = correct as string[];
        const r = response as string[];
        if (!Array.isArray(c) || !Array.isArray(r) || c.length === 0) return 0;
        const correctIds = new Set(c);
        const correctSelections = new Set(r.filter((id) => correctIds.has(id)));
        return correctSelections.size / correctIds.size;
      }
      case QuestionType.MATCHING: {
        const c = correct as { leftId: string; rightId: string }[];
        const r = response as { leftId: string; rightId: string }[];
        if (!Array.isArray(c) || !Array.isArray(r) || c.length === 0) return 0;
        const key = (p: { leftId: string; rightId: string }) =>
          `${p.leftId}:${p.rightId}`;
        const correctPairs = new Set(c.map(key));
        const correctMatches = new Set(
          r.map(key).filter((pair) => correctPairs.has(pair)),
        );
        return correctMatches.size / correctPairs.size;
      }
      case QuestionType.FILL_BLANK: {
        const c = correct as string[];
        const r = response as string[];
        if (!Array.isArray(c) || !Array.isArray(r) || c.length !== r.length)
          return 0;
        return c.every(
          (ans, i) =>
            String(ans).toLowerCase().trim() ===
            String(r[i] ?? '')
              .toLowerCase()
              .trim(),
        )
          ? 1
          : 0;
      }
      default:
        return 0;
    }
  }

  private isFullyCorrectAnswer(
    type: QuestionType,
    correct: unknown,
    response: unknown,
  ): boolean {
    if (response === null || response === undefined) return false;
    switch (type) {
      case QuestionType.TRUE_FALSE:
      case QuestionType.MULTIPLE_CHOICE:
        return correct === response;
      case QuestionType.MULTIPLE_SELECT: {
        const c = correct as string[];
        const r = response as string[];
        if (!Array.isArray(c) || !Array.isArray(r) || c.length !== r.length)
          return false;
        const correctIds = new Set(c);
        return (
          new Set(r).size === correctIds.size &&
          r.every((id) => correctIds.has(id))
        );
      }
      case QuestionType.MATCHING: {
        const c = correct as { leftId: string; rightId: string }[];
        const r = response as { leftId: string; rightId: string }[];
        if (!Array.isArray(c) || !Array.isArray(r) || c.length !== r.length)
          return false;
        const key = (p: { leftId: string; rightId: string }) =>
          `${p.leftId}:${p.rightId}`;
        const correctPairs = new Set(c.map(key));
        return (
          new Set(r.map(key)).size === correctPairs.size &&
          r.every((pair) => correctPairs.has(key(pair)))
        );
      }
      case QuestionType.FILL_BLANK:
        return this.getScoreRatio(type, correct, response) === 1;
      default:
        return false;
    }
  }

  private async computeSummary(sessionId: string, examId: string) {
    const [totalPoints, examQs, answers] = await Promise.all([
      this.prisma.examQuestion.aggregate({
        where: { examId },
        _sum: { points: true },
      }),
      this.prisma.examQuestion.findMany({
        where: { examId },
        select: { type: true },
      }),
      this.prisma.answer.findMany({
        where: { sessionId },
        select: { pointsAwarded: true },
      }),
    ]);

    const maxScore = totalPoints._sum.points ?? 0;
    const hasManual = examQs.some((q) => !AUTO_GRADED_TYPES.includes(q.type));

    if (hasManual) {
      return { maxScore };
    }

    const score = answers.reduce((sum, a) => sum + (a.pointsAwarded ?? 0), 0);
    return { score, maxScore };
  }
}
