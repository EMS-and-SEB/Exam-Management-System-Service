import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../common/exceptions/app-exceptions.js';
import {
  ExamStatus,
  Prisma,
  QuestionType,
  StaffRole,
  SessionStatus,
} from '../generated/prisma/client.js';
import type { ExamSession } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  SaveAnswerDto,
  StudentLoginDto,
} from './validation/sessions.dto.js';
import { SEB_HANDSHAKE_AUDIENCE, SEB_HANDSHAKE_ISSUER } from '../seb/seb.constants.js';

const AUTO_GRADED_TYPES: QuestionType[] = [
  QuestionType.TRUE_FALSE,
  QuestionType.MULTIPLE_CHOICE,
  QuestionType.MATCHING,
  QuestionType.FILL_BLANK,
];

function formatScore(score: number): number {
  return Number(score.toFixed(2));
}

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // ---------------- LOGIN ----------------
  async studentLogin(dto: StudentLoginDto) {
    let handshakeId: string;
    try {
      const handshake = this.jwtService.verify<{ type?: string; jti?: string }>(dto.handshakeToken, {
        secret: this.configService.getOrThrow<string>('seb.handshakeSecret'),
        issuer: SEB_HANDSHAKE_ISSUER,
        audience: SEB_HANDSHAKE_AUDIENCE,
        algorithms: ['HS256'],
      });
      if (
        handshake.type !== 'seb-handshake' ||
        typeof handshake.jti !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(handshake.jti)
      ) throw new Error('Unexpected handshake token purpose or identifier.');
      handshakeId = handshake.jti;
    } catch {
      throw AppException.unauthorized('A valid SEB client handshake is required to log in.');
    }

    return this.prisma.$transaction(async (tx) => {
      const otp = await tx.examOTP.findFirst({ where: { code: dto.otp } });
      if (!otp) throw AppException.unauthorized('Invalid or expired OTP.');

      // Login shares a lock with exam closure. A closure cannot miss a session
      // created after it has enumerated the exam's active sessions.
      await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "Exam" WHERE id = ${otp.examId} FOR SHARE`,
      );

      const exam = await tx.exam.findUnique({
        where: { id: otp.examId },
        include: {
          course: { select: { status: true } },
          cohort: { select: { status: true } },
        },
      });
      if (!exam || exam.status !== ExamStatus.RELEASED) {
        throw AppException.unauthorized('Exam is not available for login.');
      }
      if (exam.course?.status === 'ARCHIVED' || exam.cohort?.status === 'ARCHIVED') {
        throw AppException.unauthorized('Exam is not available for login.');
      }

      const now = await this.databaseNow(tx);
      if (!exam.scheduledStart || !exam.durationMinutes) {
        throw AppException.unauthorized('Exam is not fully configured.');
      }
      if (now > otp.expiresAt) {
        throw AppException.unauthorized('Login window has expired.');
      }

      const student = await tx.studentDirectory.findUnique({ where: { studentId: dto.studentId } });
      if (!student) throw AppException.unauthorized('Student not found.');

      const roster = await tx.examRoster.findUnique({
        where: { examId_studentId: { examId: exam.id, studentId: student.id } },
      });
      if (!roster) throw AppException.unauthorized('You are not on this exam roster.');

      const existing = await tx.examSession.findUnique({
        where: { examId_studentId: { examId: exam.id, studentId: student.id } },
      });
      if (existing) {
        await tx.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`SELECT id FROM "ExamSession" WHERE id = ${existing.id} FOR UPDATE`,
        );
        const current = await tx.examSession.findUnique({ where: { id: existing.id } });
        if (!current) throw AppException.notFound('Session not found.');
        const resumeNow = await this.databaseNow(tx);
        if (current.status === SessionStatus.NOT_STARTED && resumeNow < exam.scheduledStart) {
          const consumedHandshake = await tx.sebHandshakeToken.updateMany({
            where: { id: handshakeId, consumedAt: null, expiresAt: { gt: resumeNow } },
            data: { consumedAt: resumeNow },
          });
          if (consumedHandshake.count !== 1) {
            throw AppException.unauthorized('A valid, unused SEB client handshake is required to log in.');
          }
          return this.waitingLoginResponse(current.id, exam, student, exam.scheduledStart, resumeNow);
        }
        if (current.status === SessionStatus.NOT_STARTED && resumeNow >= exam.scheduledStart) {
          const activated = await tx.examSession.updateMany({
            where: { id: current.id, status: SessionStatus.NOT_STARTED },
            data: {
              status: SessionStatus.IN_PROGRESS,
              startedAt: resumeNow,
              endsAt: new Date(resumeNow.getTime() + exam.durationMinutes * 60_000),
            },
          });
          if (activated.count === 1) {
            Object.assign(current, {
              status: SessionStatus.IN_PROGRESS,
              startedAt: resumeNow,
              endsAt: new Date(resumeNow.getTime() + exam.durationMinutes * 60_000),
            });
          }
        }
        if (
          current.status === SessionStatus.IN_PROGRESS &&
          current.endsAt &&
          resumeNow < current.endsAt
        ) {
          const consumedHandshake = await tx.sebHandshakeToken.updateMany({
            where: { id: handshakeId, consumedAt: null, expiresAt: { gt: resumeNow } },
            data: { consumedAt: resumeNow },
          });
          if (consumedHandshake.count !== 1) {
            throw AppException.unauthorized('A valid, unused SEB client handshake is required to log in.');
          }
          const examQuestions = await this.getSessionQuestions(current, tx);
          return {
            sessionToken: current.id,
            status: SessionStatus.IN_PROGRESS,
            exam: { id: exam.id, title: exam.title, examType: exam.examType },
            scheduledStart: exam.scheduledStart,
            serverNow: resumeNow,
            endsAt: current.endsAt,
            examQuestions,
            student: { name: student.name, studentId: student.studentId },
          };
        }
        throw AppException.conflict('A session already exists for this student on this exam.');
      }

      const examQuestions = await tx.examQuestion.findMany({
        where: { examId: exam.id },
        orderBy: { order: 'asc' },
      });
      const questionOrder = this.shuffle(examQuestions.map((q) => q.id));
      const optionOrder = this.buildOptionOrder(examQuestions);
      const waiting = now < exam.scheduledStart;
      const endsAt = waiting ? null : new Date(now.getTime() + exam.durationMinutes * 60_000);

      const consumedHandshake = await tx.sebHandshakeToken.updateMany({
        where: { id: handshakeId, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumedHandshake.count !== 1) {
        throw AppException.unauthorized('A valid, unused SEB client handshake is required to log in.');
      }

      const session = await tx.examSession.create({
        data: {
          examId: exam.id,
          studentId: student.id,
          status: waiting ? SessionStatus.NOT_STARTED : SessionStatus.IN_PROGRESS,
          startedAt: waiting ? null : now,
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
        status: session.status,
        exam: { id: exam.id, title: exam.title, examType: exam.examType },
        scheduledStart: exam.scheduledStart,
        serverNow: now,
        endsAt: session.endsAt,
        examQuestions: waiting ? [] : safeQuestions,
        student: { name: student.name, studentId: student.studentId },
      };
    });
  }

  // ---------------- POLL ----------------
  async getSession(id: string) {
    let session = await this.prisma.examSession.findUnique({ where: { id } });
    if (!session) throw AppException.notFound('Session not found.');

    if (session.status === SessionStatus.NOT_STARTED) {
      return this.prisma.$transaction(async (tx) => {
        const currentInfo = await tx.examSession.findUnique({ where: { id }, select: { examId: true } });
        if (!currentInfo) throw AppException.notFound('Session not found.');
        const examStatus = await this.lockExamForSession(tx, currentInfo.examId);
        await this.lockSession(tx, id);
        const [current, exam] = await Promise.all([
          tx.examSession.findUnique({ where: { id } }),
          tx.exam.findUnique({ where: { id: currentInfo.examId }, select: { scheduledStart: true, durationMinutes: true } }),
        ]);
        if (!current || !exam) throw AppException.notFound('Session or exam not found.');
        const serverNow = await this.databaseNow(tx);
        await tx.examSession.updateMany({
          where: { id, status: { in: [SessionStatus.IN_PROGRESS, SessionStatus.NOT_STARTED] } },
          data: { lastPolledAt: serverNow },
        });
        if (examStatus !== ExamStatus.RELEASED) {
          throw AppException.forbidden('The exam is not available to start.');
        }
        if (current.status === SessionStatus.NOT_STARTED && serverNow < (exam.scheduledStart ?? new Date(0))) {
          return { status: SessionStatus.NOT_STARTED, scheduledStart: exam.scheduledStart, serverNow };
        }
        if (current.status === SessionStatus.NOT_STARTED) {
          if (!exam.scheduledStart || !exam.durationMinutes) {
            throw AppException.forbidden('The exam is not available to start.');
          }
          const scheduledEnd = new Date(exam.scheduledStart.getTime() + exam.durationMinutes * 60_000);
          if (serverNow >= scheduledEnd) {
            const expired = await tx.examSession.update({
              where: { id },
              data: { status: SessionStatus.EXPIRED, submittedAt: serverNow },
            });
            return { status: expired.status, submittedAt: expired.submittedAt, ...(await this.computeSummary(id, current.examId, tx)) };
          }
          const endsAt = new Date(serverNow.getTime() + exam.durationMinutes * 60_000);
          await tx.examSession.update({
            where: { id },
            data: { status: SessionStatus.IN_PROGRESS, startedAt: serverNow, endsAt },
          });
          session = { ...current, status: SessionStatus.IN_PROGRESS, startedAt: serverNow, endsAt };
        } else {
          session = current;
        }
        return this.getLiveSessionResponse(session, serverNow, tx);
      });
    }

    if (
      session.status === SessionStatus.IN_PROGRESS &&
      session.endsAt &&
      (await this.databaseNow(this.prisma)) >= session.endsAt
    ) {
      session = await this.prisma.$transaction(async (tx) => {
        const initial = await tx.examSession.findUnique({ where: { id }, select: { examId: true } });
        if (!initial) throw AppException.notFound('Session not found.');
        const examStatus = await this.lockExamForSession(tx, initial.examId);
        await this.lockSession(tx, id);
        const current = await tx.examSession.findUnique({ where: { id } });
        if (!current) throw AppException.notFound('Session not found.');
        return this.finalizeExpiredSession(current, examStatus, tx, await this.databaseNow(tx));
      });
    }

    const now = new Date();
    await this.prisma.examSession.updateMany({
      where: { id, status: { in: [SessionStatus.IN_PROGRESS, SessionStatus.NOT_STARTED] } },
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

    return this.getLiveSessionResponse(session, await this.databaseNow(this.prisma));
  }

  // ---------------- AUTOSAVE ----------------
  async saveAnswer(id: string, dto: SaveAnswerDto) {
    const wasLate = await this.prisma.$transaction(async (tx) => {
      const initial = await tx.examSession.findUnique({ where: { id }, select: { examId: true } });
      if (!initial) throw AppException.notFound('Session not found.');
      const examStatus = await this.lockExamForSession(tx, initial.examId);
      await this.lockSession(tx, id);
      const session = await tx.examSession.findUnique({ where: { id } });
      if (!session) throw AppException.notFound('Session not found.');
      if (session.status !== SessionStatus.IN_PROGRESS) {
        throw AppException.forbidden('Session is not accepting answers.');
      }
      if (examStatus !== ExamStatus.RELEASED) {
        throw AppException.forbidden('The exam is closed and is not accepting answers.');
      }
      const unresolvedIncident = await tx.incident.findFirst({
        where: { sessionId: id, resolvedAt: null },
      });
      if (unresolvedIncident) {
        throw AppException.forbidden('Session is locked out due to an unresolved incident.');
      }

      const eq = await tx.examQuestion.findUnique({ where: { id: dto.examQuestionId } });
      if (!eq || eq.examId !== session.examId) {
        throw AppException.badRequest('This question does not belong to the session exam.');
      }

      // Put the deadline predicate in the answer write statement itself. An
      // application-side clock check before the intervening reads leaves a
      // time-of-check/time-of-use window near endsAt.
      const responseData = JSON.stringify(dto.responseData ?? null);
      const saved = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        INSERT INTO "Answer" ("id", "sessionId", "examQuestionId", "responseData")
        SELECT ${randomUUID()}::uuid, session."id", ${dto.examQuestionId}::uuid, ${responseData}::jsonb
        FROM "ExamSession" AS session
        WHERE session."id" = ${id}::uuid
          AND session."status" = 'IN_PROGRESS'
          AND (session."endsAt" IS NULL OR session."endsAt" > clock_timestamp())
          AND EXISTS (
            SELECT 1 FROM "ExamQuestion" AS question
            WHERE question."id" = ${dto.examQuestionId}::uuid
              AND question."examId" = session."examId"
          )
        ON CONFLICT ("sessionId", "examQuestionId")
        DO UPDATE SET "responseData" = EXCLUDED."responseData"
        WHERE EXISTS (
          SELECT 1 FROM "ExamSession" AS session
          WHERE session."id" = EXCLUDED."sessionId"
            AND session."status" = 'IN_PROGRESS'
            AND (session."endsAt" IS NULL OR session."endsAt" > clock_timestamp())
        )
        RETURNING "id"
      `);
      if (saved.length === 0) {
        const now = await this.databaseNow(tx);
        await this.finalizeExpiredSession(session, examStatus, tx, now);
        return true;
      }
      await tx.examSession.update({ where: { id }, data: { lastPolledAt: new Date() } });
      return false;
    });

    if (wasLate) throw AppException.conflict('The exam deadline has passed; the session was finalized.');

    return { saved: true };
  }

  // ---------------- SUBMIT ----------------
  async submit(id: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const initial = await tx.examSession.findUnique({ where: { id }, select: { examId: true } });
      if (!initial) throw AppException.notFound('Session not found.');
      const examStatus = await this.lockExamForSession(tx, initial.examId);
      await this.lockSession(tx, id);
      const session = await tx.examSession.findUnique({ where: { id } });
      if (!session) throw AppException.notFound('Session not found.');
      if (
        session.status === SessionStatus.SUBMITTED ||
        session.status === SessionStatus.FORCE_SUBMITTED ||
        session.status === SessionStatus.EXPIRED
      ) {
        return { session, summary: await this.computeSummary(session.id, session.examId, tx) };
      }
      if (session.status === SessionStatus.NOT_STARTED) {
        throw AppException.forbidden('The exam session has not started yet.');
      }
      if (examStatus !== ExamStatus.RELEASED) {
        throw AppException.forbidden('The exam is closed and the session was not finalized.');
      }

      const now = await this.databaseNow(tx);
      if (session.endsAt && now >= session.endsAt) {
        const expired = await this.finalizeExpiredSession(session, examStatus, tx, now);
        return { session: expired, summary: await this.computeSummary(expired.id, expired.examId, tx) };
      }

      const hasAnswers = await tx.answer.count({ where: { sessionId: id } });
      const newStatus = hasAnswers > 0 ? SessionStatus.SUBMITTED : SessionStatus.EXPIRED;
      const submittedAt = new Date();
      const updated = await tx.examSession.update({
        where: { id },
        data: { status: newStatus, submittedAt },
      });
      if (newStatus === SessionStatus.SUBMITTED) await this.gradeAutoAnswers(id, tx);
      return { session: updated, summary: await this.computeSummary(updated.id, updated.examId, tx) };
    });

    return {
      status: result.session.status,
      submittedAt: result.session.submittedAt,
      ...result.summary,
    };
  }

  async forceSubmitForExam(examId: string, tx: Prisma.TransactionClient) {
    const submittedAt = new Date();
    const sessions = await tx.examSession.updateManyAndReturn({
      where: { examId, status: SessionStatus.IN_PROGRESS },
      data: { status: SessionStatus.FORCE_SUBMITTED, submittedAt },
      select: { id: true },
    });
    for (const session of sessions) {
      await this.gradeAutoAnswers(session.id, tx);
    }
    return sessions.map((session) => session.id);
  }

  /** Caller must hold the exam lock followed by the session row lock. */
  async forceSubmitForIncident(sessionId: string, tx: Prisma.TransactionClient) {
    const submittedAt = new Date();
    const transitioned = await tx.examSession.updateMany({
      where: { id: sessionId, status: SessionStatus.IN_PROGRESS },
      data: { status: SessionStatus.FORCE_SUBMITTED, submittedAt },
    });
    if (transitioned.count !== 1) {
      throw AppException.conflict('The exam session is no longer active and cannot be terminated.');
    }
    await this.gradeAutoAnswers(sessionId, tx);
    return tx.examSession.findUniqueOrThrow({ where: { id: sessionId } });
  }

  /** Invigilator-confirmed SEB exit. Waiting and terminal sessions are preserved. */
  async exitByAuthorizedInvigilator(sessionId: string, invigilatorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const initial = await tx.examSession.findUnique({ where: { id: sessionId }, select: { examId: true } });
      if (!initial) throw AppException.notFound('Exam session not found.');
      const examStatus = await this.lockExamForSession(tx, initial.examId);
      await this.lockSession(tx, sessionId);
      const session = await tx.examSession.findUnique({ where: { id: sessionId } });
      if (!session) throw AppException.notFound('Exam session not found.');

      const assignment = await tx.examInvigilator.findFirst({
        where: { examId: session.examId, invigilatorId },
        select: { invigilator: { select: { id: true, isActive: true, role: true } } },
      });
      await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "StaffAccount" WHERE id = ${invigilatorId} FOR SHARE`,
      );
      const staff = await tx.staffAccount.findUnique({
        where: { id: invigilatorId },
        select: { isActive: true, role: true },
      });
      const allowedRole = staff !== null && staff !== undefined &&
        [StaffRole.INVIGILATOR, StaffRole.INSTRUCTOR, StaffRole.EXIT_EXAM_COORDINATOR]
          .some((role) => role === staff.role);
      if (!assignment?.invigilator.isActive || !staff?.isActive || !allowedRole) {
        throw AppException.unauthorized('The assigned invigilator account is no longer active.');
      }

      if (session.status !== SessionStatus.IN_PROGRESS) {
        return { status: session.status, sessionTerminated: false };
      }
      if (examStatus !== ExamStatus.RELEASED) {
        throw AppException.conflict('The exam session is no longer available for an invigilator exit.');
      }
      if (!session.endsAt) {
        throw AppException.conflict('The exam session has no valid deadline and cannot be exited.');
      }

      const now = await this.databaseNow(tx);
      if (now >= session.endsAt) {
        const expired = await this.finalizeExpiredSession(session, examStatus, tx, now);
        return { status: expired.status, sessionTerminated: false };
      }

      const terminated = await this.forceSubmitForIncident(sessionId, tx);
      await tx.auditLog.create({
        data: {
          actorId: invigilatorId,
          action: 'FORCE_SUBMIT',
          entityType: 'ExamSession',
          entityId: sessionId,
          metadata: { source: 'SEB_EXIT_SHORTCUT' },
        },
      });
      return { status: terminated.status, sessionTerminated: true };
    });
  }

  private async finalizeExpiredSession(
    session: ExamSession,
    examStatus: ExamStatus,
    tx: Prisma.TransactionClient,
    now: Date,
  ) {
    if (
      session.status !== SessionStatus.IN_PROGRESS ||
      !session.endsAt ||
      now < session.endsAt
    ) return session;
    if (examStatus !== ExamStatus.RELEASED) {
      throw AppException.forbidden('The exam is closed and is not accepting session changes.');
    }

    const hasAnswers = await tx.answer.count({ where: { sessionId: session.id } });
    const status = hasAnswers > 0 ? SessionStatus.SUBMITTED : SessionStatus.EXPIRED;
    const submittedAt = now;
    const transitioned = await tx.examSession.updateMany({
      where: { id: session.id, status: SessionStatus.IN_PROGRESS, endsAt: { lte: now } },
      data: { status, submittedAt },
    });
    if (transitioned.count !== 1) {
      const latest = await tx.examSession.findUniqueOrThrow({ where: { id: session.id } });
      if (latest.status !== SessionStatus.IN_PROGRESS) return latest;
      throw AppException.conflict('The exam session changed while it was being finalized.');
    }
    if (status === SessionStatus.SUBMITTED) await this.gradeAutoAnswers(session.id, tx);
    return tx.examSession.findUniqueOrThrow({ where: { id: session.id } });
  }

  private async databaseNow(tx: Prisma.TransactionClient) {
    const [row] = await tx.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT clock_timestamp() AS "now"`);
    if (!row?.now) throw AppException.internal('Could not determine the exam server time.');
    return row.now;
  }

  private waitingLoginResponse(
    sessionToken: string,
    exam: { id: string; title: string; examType: string },
    student: { name: string; studentId: string },
    scheduledStart: Date,
    serverNow: Date,
  ) {
    return {
      sessionToken,
      status: SessionStatus.NOT_STARTED,
      exam: { id: exam.id, title: exam.title, examType: exam.examType },
      scheduledStart,
      serverNow,
      endsAt: null,
      examQuestions: [],
      student: { name: student.name, studentId: student.studentId },
    };
  }

  private async getLiveSessionResponse(
    session: ExamSession,
    serverNow: Date,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const questions = await this.getSessionQuestions(session, db);
    const answers = await db.answer.findMany({
      where: { sessionId: session.id },
      select: { examQuestionId: true, responseData: true },
    });
    return {
      status: session.status,
      scheduledStart: null,
      serverNow,
      endsAt: session.endsAt,
      questions,
      answers,
    };
  }

  private async lockSession(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM "ExamSession" WHERE id = ${id} FOR UPDATE`,
    );
  }

  private async lockExamForSession(tx: Prisma.TransactionClient, examId: string) {
    await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM "Exam" WHERE id = ${examId} FOR SHARE`,
    );
    const exam = await tx.exam.findUnique({ where: { id: examId }, select: { status: true } });
    if (!exam) throw AppException.notFound('Exam not found.');
    return exam.status;
  }

  // ---------------- HELPERS ----------------
  private async getSessionQuestions(
    session: {
    examId: string;
    questionOrder: unknown;
    optionOrder: unknown;
    },
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const examQuestions = await db.examQuestion.findMany({
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
      if (q.type === QuestionType.MULTIPLE_CHOICE) {
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
    if (q.type === QuestionType.MULTIPLE_CHOICE) {
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

  private async gradeAutoAnswers(
    sessionId: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const answers = await db.answer.findMany({
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
        q.correctAnswerCount,
      );
      const isCorrect = this.isFullyCorrectAnswer(
        q.type,
        q.correctAnswer,
        ans.responseData,
        q.correctAnswerCount,
      );
      const pointsAwarded = q.points * scoreRatio;
      await db.answer.update({
        where: { id: ans.id },
        data: { isCorrect, pointsAwarded },
      });
    }
  }

  private getScoreRatio(
    type: QuestionType,
    correct: unknown,
    response: unknown,
    correctAnswerCount = 1,
  ): number {
    if (response === null || response === undefined) return 0;
    switch (type) {
      case QuestionType.TRUE_FALSE:
        return correct === response ? 1 : 0;
      case QuestionType.MULTIPLE_CHOICE: {
        const c = correct as string[];
        if (!Array.isArray(c) || c.length === 0) return 0;
        if (correctAnswerCount === 1) return typeof response === 'string' && c[0] === response ? 1 : 0;
        const r = response as string[];
        if (!Array.isArray(r)) return 0;
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
    correctAnswerCount = 1,
  ): boolean {
    if (response === null || response === undefined) return false;
    switch (type) {
      case QuestionType.TRUE_FALSE:
        return correct === response;
      case QuestionType.MULTIPLE_CHOICE: {
        const c = correct as string[];
        if (!Array.isArray(c) || c.length === 0) return false;
        if (correctAnswerCount === 1) return typeof response === 'string' && c[0] === response;
        const r = response as string[];
        if (!Array.isArray(r)) return false;
        const correctIds = new Set(c);
        const selectedIds = new Set(r);
        return (
          selectedIds.size === r.length &&
          selectedIds.size === correctIds.size &&
          [...selectedIds].every((id) => correctIds.has(id))
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

  private async computeSummary(
    sessionId: string,
    examId: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const [totalPoints, examQs, answers] = await Promise.all([
      db.examQuestion.aggregate({
        where: { examId },
        _sum: { points: true },
      }),
      db.examQuestion.findMany({
        where: { examId },
        select: { type: true },
      }),
      db.answer.findMany({
        where: { sessionId },
        select: { pointsAwarded: true },
      }),
    ]);

    const maxScore = totalPoints._sum.points ?? 0;
    const hasManual = examQs.some((q) => !AUTO_GRADED_TYPES.includes(q.type));

    if (hasManual) {
      return { maxScore: formatScore(maxScore) };
    }

    const score = answers.reduce((sum, a) => sum + (a.pointsAwarded ?? 0), 0);
    return { score: formatScore(score), maxScore: formatScore(maxScore) };
  }
}
