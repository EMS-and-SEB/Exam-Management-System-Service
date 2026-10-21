import { SessionsService } from './sessions.service.js';
import { QuestionType, SessionStatus, ExamStatus } from '../generated/prisma/client.js';

function createService(tx?: Record<string, unknown>) {
  const transactionClient = tx ?? {};
  const prisma = {
    $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(transactionClient)),
  };
  const service = new SessionsService(prisma as never, {} as never, {} as never);
  return { service, prisma, tx: transactionClient };
}

describe('SessionsService terminal-state protections', () => {
  it('does not save answers after a terminal session state', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'exam-id' }]),
      exam: { findUnique: vi.fn().mockResolvedValue({ status: ExamStatus.RELEASED }) },
      examSession: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ examId: 'exam-id' })
          .mockResolvedValueOnce({ id: 'session-id', examId: 'exam-id', status: SessionStatus.FORCE_SUBMITTED }),
      },
      answer: { upsert: vi.fn() },
    };
    const { service } = createService(tx);

    await expect(service.saveAnswer('session-id', {
      examQuestionId: 'question-id',
      responseData: 'option-id',
    } as never)).rejects.toThrow();
    expect(tx.answer.upsert).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('keeps repeated normal submission idempotent for an already force-submitted session', async () => {
    const submittedAt = new Date('2026-10-14T10:00:00Z');
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      exam: { findUnique: vi.fn().mockResolvedValue({ status: ExamStatus.CLOSED }) },
      examSession: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ examId: 'exam-id' })
          .mockResolvedValueOnce({
            id: 'session-id',
            examId: 'exam-id',
            status: SessionStatus.FORCE_SUBMITTED,
            submittedAt,
          }),
        update: vi.fn(),
      },
      examQuestion: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { points: 5 } }),
        findMany: vi.fn().mockResolvedValue([{ type: QuestionType.MULTIPLE_CHOICE }]),
      },
      answer: { findMany: vi.fn().mockResolvedValue([{ pointsAwarded: 3 }]) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)),
    };
    const service = new SessionsService(prisma as never, {} as never, {} as never);

    await expect(service.submit('session-id')).resolves.toEqual({
      status: SessionStatus.FORCE_SUBMITTED,
      submittedAt,
      score: 3,
      maxScore: 5,
    });
    expect(tx.examSession.update).not.toHaveBeenCalled();
  });

  it('grades only sessions transitioned by the forced-submit update', async () => {
    const tx = {
      examSession: {
        updateManyAndReturn: vi.fn().mockResolvedValue([{ id: 'session-a' }, { id: 'session-b' }]),
      },
      answer: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const { service } = createService();

    await expect(service.forceSubmitForExam('exam-id', tx as never)).resolves.toEqual([
      'session-a',
      'session-b',
    ]);
    expect(tx.examSession.updateManyAndReturn).toHaveBeenCalledWith(expect.objectContaining({
      where: { examId: 'exam-id', status: SessionStatus.IN_PROGRESS },
      data: expect.objectContaining({ status: SessionStatus.FORCE_SUBMITTED }),
    }));
    expect(tx.answer.findMany).toHaveBeenCalledTimes(2);
  });

  it('leaves workout answers pending manual grading during forced submission', async () => {
    const answerUpdate = vi.fn();
    const tx = {
      examSession: { updateManyAndReturn: vi.fn().mockResolvedValue([{ id: 'session-a' }]) },
      answer: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'workout-answer',
          responseData: 'written response',
          examQuestion: {
            type: QuestionType.WORKOUT,
            correctAnswer: null,
            correctAnswerCount: 1,
            points: 5,
          },
        }]),
        update: answerUpdate,
      },
    };
    const { service } = createService();

    await service.forceSubmitForExam('exam-id', tx as never);
    expect(answerUpdate).not.toHaveBeenCalled();
  });
});

describe('SessionsService answer restoration', () => {
  it('returns only answers associated with the polled session', async () => {
    const question = { id: 'question-a', examId: 'exam-id', type: QuestionType.WORKOUT };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ now: new Date() }]),
      examSession: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'session-a', examId: 'exam-id', status: SessionStatus.IN_PROGRESS,
          endsAt: new Date(Date.now() + 60_000), questionOrder: ['question-a'], optionOrder: {},
        }),
        updateMany: vi.fn(),
      },
      examQuestion: { findMany: vi.fn().mockResolvedValue([question]) },
      answer: { findMany: vi.fn().mockResolvedValue([
        { examQuestionId: 'question-a', responseData: 'saved response' },
      ]) },
    };
    const prisma = {
      ...tx,
      $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)),
    };
    const service = new SessionsService(prisma as never, {} as never, {} as never);

    await expect(service.getSession('session-a')).resolves.toMatchObject({
      status: SessionStatus.IN_PROGRESS,
      questions: [{ id: 'question-a' }],
      answers: [{ examQuestionId: 'question-a', responseData: 'saved response' }],
    });
    expect(tx.answer.findMany).toHaveBeenCalledWith({
      where: { sessionId: 'session-a' },
      select: { examQuestionId: true, responseData: true },
    });
  });
});

describe('SessionsService session resumption', () => {
  it('returns the existing valid active session without creating a second attempt', async () => {
    const now = new Date('2026-10-15T07:00:00.000Z');
    const endsAt = new Date('2026-10-15T08:00:00.000Z');
    const examQuestion = {
      id: 'question-a', examId: 'exam-id', sourceQuestionId: null,
      type: QuestionType.WORKOUT, prompt: 'Explain', options: null,
      points: 2, order: 1, correctAnswer: null, correctAnswerCount: 1,
    };
    const existing = {
      id: 'session-existing', examId: 'exam-id', status: SessionStatus.IN_PROGRESS,
      endsAt, questionOrder: ['question-a'], optionOrder: {},
    };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ now }]),
      examOTP: { findFirst: vi.fn().mockResolvedValue({ examId: 'exam-id', expiresAt: new Date('2026-10-15T09:00:00Z') }) },
      exam: { findUnique: vi.fn().mockResolvedValue({
        id: 'exam-id', title: 'Exam', examType: 'MIDTERM', status: ExamStatus.RELEASED,
        scheduledStart: new Date('2026-10-15T06:00:00Z'), durationMinutes: 90,
        course: { status: 'ACTIVE' }, cohort: { status: 'ACTIVE' },
      }) },
      studentDirectory: { findUnique: vi.fn().mockResolvedValue({ id: 'student-db-id', name: 'Student', studentId: 'AAU-1' }) },
      examRoster: { findUnique: vi.fn().mockResolvedValue({ examId: 'exam-id', studentId: 'student-db-id' }) },
      examSession: {
        findUnique: vi.fn().mockResolvedValue(existing),
        create: vi.fn(),
      },
      sebHandshakeToken: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      examQuestion: { findMany: vi.fn().mockResolvedValue([examQuestion]) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)),
    };
    const jwtService = { verify: vi.fn().mockReturnValue({
      type: 'seb-handshake', jti: '10000000-0000-4000-8000-000000000001',
    }) };
    const configService = { getOrThrow: vi.fn().mockReturnValue('test-secret') };
    const service = new SessionsService(prisma as never, jwtService as never, configService as never);

    await expect(service.studentLogin({
      studentId: 'AAU-1', otp: '123456', handshakeToken: 'valid-handshake',
    } as never)).resolves.toMatchObject({
      sessionToken: 'session-existing',
      endsAt,
      examQuestions: [{ id: 'question-a' }],
      student: { studentId: 'AAU-1' },
    });
    expect(tx.examSession.create).not.toHaveBeenCalled();
    expect(tx.sebHandshakeToken.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe('SessionsService invigilator-authorized SEB exit', () => {
  function exitTransaction(status: SessionStatus) {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
      exam: { findUnique: vi.fn().mockResolvedValue({ status: ExamStatus.RELEASED }) },
      examSession: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ examId: 'exam-id' })
          .mockResolvedValueOnce({
            id: 'session-id', examId: 'exam-id', status,
            endsAt: new Date('2026-10-15T10:00:00.000Z'),
          }),
      },
      examInvigilator: {
        findFirst: vi.fn().mockResolvedValue({ invigilator: { id: 'staff-id', isActive: true, role: 'INVIGILATOR' } }),
      },
      staffAccount: { findUnique: vi.fn().mockResolvedValue({ isActive: true, role: 'INVIGILATOR' }) },
      auditLog: { create: vi.fn() },
    };
    const { service } = createService(tx);
    return { service, tx };
  }

  it('force-submits and audits an active session after authorized exit', async () => {
    const { service, tx } = exitTransaction(SessionStatus.IN_PROGRESS);
    vi.spyOn(service, 'forceSubmitForIncident').mockResolvedValue({ status: SessionStatus.FORCE_SUBMITTED } as never);
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: 'exam-id' }])
      .mockResolvedValueOnce([{ id: 'session-id' }])
      .mockResolvedValueOnce([{ id: 'staff-id' }])
      .mockResolvedValueOnce([{ now: new Date('2026-10-15T09:00:00.000Z') }]);

    await expect(service.exitByAuthorizedInvigilator('session-id', 'staff-id')).resolves.toEqual({
      status: SessionStatus.FORCE_SUBMITTED,
      sessionTerminated: true,
    });
    expect(service.forceSubmitForIncident).toHaveBeenCalledWith('session-id', tx);
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        actorId: 'staff-id', action: 'FORCE_SUBMIT', entityId: 'session-id',
        metadata: { source: 'SEB_EXIT_SHORTCUT' },
      }),
    }));
  });

  it('preserves a waiting session and does not force-submit it', async () => {
    const { service, tx } = exitTransaction(SessionStatus.NOT_STARTED);
    const forceSubmit = vi.spyOn(service, 'forceSubmitForIncident');

    await expect(service.exitByAuthorizedInvigilator('session-id', 'staff-id')).resolves.toEqual({
      status: SessionStatus.NOT_STARTED,
      sessionTerminated: false,
    });
    expect(forceSubmit).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.examSession.findUnique).toHaveBeenCalledTimes(2);
  });
});

describe('SessionsService early exam access', () => {
  it('authenticates an eligible early student into one question-free waiting session', async () => {
    const now = new Date('2026-10-15T07:20:00.000Z');
    const scheduledStart = new Date('2026-10-15T07:32:00.000Z');
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ now }]),
      examOTP: { findFirst: vi.fn().mockResolvedValue({ examId: 'exam-id', expiresAt: new Date('2026-10-15T08:32:00Z') }) },
      exam: { findUnique: vi.fn().mockResolvedValue({
        id: 'exam-id', title: 'Exam', examType: 'MIDTERM', status: ExamStatus.RELEASED,
        scheduledStart, durationMinutes: 60,
        course: { status: 'ACTIVE' }, cohort: { status: 'ACTIVE' },
      }) },
      studentDirectory: { findUnique: vi.fn().mockResolvedValue({ id: 'student-id', name: 'Student', studentId: 'AAU-1' }) },
      examRoster: { findUnique: vi.fn().mockResolvedValue({ examId: 'exam-id', studentId: 'student-id' }) },
      examSession: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'waiting-session', status: SessionStatus.NOT_STARTED, endsAt: null }),
      },
      examQuestion: { findMany: vi.fn().mockResolvedValue([{ id: 'question-1', type: QuestionType.WORKOUT }]) },
      sebHandshakeToken: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = { $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)) };
    const jwtService = { verify: vi.fn().mockReturnValue({ type: 'seb-handshake', jti: '10000000-0000-4000-8000-000000000001' }) };
    const configService = { getOrThrow: vi.fn().mockReturnValue('test-secret') };
    const service = new SessionsService(prisma as never, jwtService as never, configService as never);

    await expect(service.studentLogin({ studentId: 'AAU-1', otp: '123456', handshakeToken: 'valid' } as never))
      .resolves.toMatchObject({
        sessionToken: 'waiting-session', status: SessionStatus.NOT_STARTED,
        scheduledStart, serverNow: now, endsAt: null, examQuestions: [],
      });
    expect(tx.examSession.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: SessionStatus.NOT_STARTED, startedAt: null, endsAt: null }),
    }));
  });

  it('does not return questions or answers while the server says the session is waiting', async () => {
    const serverNow = new Date('2026-10-15T07:20:00.000Z');
    const scheduledStart = new Date('2026-10-15T07:32:00.000Z');
    const waiting = {
      id: 'waiting-session', examId: 'exam-id', status: SessionStatus.NOT_STARTED,
      startedAt: null, endsAt: null, questionOrder: ['question-1'], optionOrder: {},
    };
    const tx = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{ id: 'exam-id' }])
        .mockResolvedValueOnce([{ id: 'waiting-session' }])
        .mockResolvedValueOnce([{ now: serverNow }]),
      examSession: {
        findUnique: vi.fn().mockResolvedValueOnce({ examId: 'exam-id' }).mockResolvedValueOnce(waiting),
        updateMany: vi.fn(),
      },
      exam: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ status: ExamStatus.RELEASED })
          .mockResolvedValueOnce({ scheduledStart, durationMinutes: 60 }),
      },
    };
    const prisma = {
      examSession: { findUnique: vi.fn().mockResolvedValue(waiting) },
      $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)),
    };
    const service = new SessionsService(prisma as never, {} as never, {} as never);

    await expect(service.getSession('waiting-session')).resolves.toEqual({
      status: SessionStatus.NOT_STARTED, scheduledStart, serverNow,
    });
    expect(tx.examSession.updateMany).toHaveBeenCalled();
  });

  it('activates the existing waiting session at the scheduled time and then returns questions', async () => {
    const serverNow = new Date('2026-10-15T07:32:00.000Z');
    const scheduledStart = new Date('2026-10-15T07:32:00.000Z');
    const waiting = {
      id: 'waiting-session', examId: 'exam-id', status: SessionStatus.NOT_STARTED,
      startedAt: null, endsAt: null, questionOrder: ['question-1'], optionOrder: {},
    };
    const tx = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{ id: 'exam-id' }])
        .mockResolvedValueOnce([{ id: 'waiting-session' }])
        .mockResolvedValueOnce([{ now: serverNow }]),
      examSession: {
        findUnique: vi.fn().mockResolvedValueOnce({ examId: 'exam-id' }).mockResolvedValueOnce(waiting),
        updateMany: vi.fn(),
        update: vi.fn().mockResolvedValue({ ...waiting, status: SessionStatus.IN_PROGRESS, startedAt: serverNow, endsAt: new Date('2026-10-15T08:32:00Z') }),
      },
      exam: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ status: ExamStatus.RELEASED })
          .mockResolvedValueOnce({ scheduledStart, durationMinutes: 60 }),
      },
      examQuestion: { findMany: vi.fn().mockResolvedValue([{ id: 'question-1', type: QuestionType.WORKOUT }]) },
      answer: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const prisma = {
      examSession: { findUnique: vi.fn().mockResolvedValue(waiting) },
      $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)),
    };
    const service = new SessionsService(prisma as never, {} as never, {} as never);

    await expect(service.getSession('waiting-session')).resolves.toMatchObject({
      status: SessionStatus.IN_PROGRESS,
      serverNow,
      endsAt: new Date('2026-10-15T08:32:00Z'),
      questions: [{ id: 'question-1' }],
      answers: [],
    });
    expect(tx.examSession.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'waiting-session' },
      data: expect.objectContaining({ status: SessionStatus.IN_PROGRESS, startedAt: serverNow }),
    }));
  });

  it('does not allow a waiting session to be submitted before the scheduled start', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
      exam: { findUnique: vi.fn().mockResolvedValue({ status: ExamStatus.RELEASED }) },
      examSession: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ examId: 'exam-id' })
          .mockResolvedValueOnce({ id: 'waiting-session', examId: 'exam-id', status: SessionStatus.NOT_STARTED }),
        update: vi.fn(),
      },
    };
    const prisma = { $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)) };
    const service = new SessionsService(prisma as never, {} as never, {} as never);

    await expect(service.submit('waiting-session')).rejects.toThrow('has not started yet');
    expect(tx.examSession.update).not.toHaveBeenCalled();
  });

  it('does not accept answer writes before the scheduled start', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
      exam: { findUnique: vi.fn().mockResolvedValue({ status: ExamStatus.RELEASED }) },
      examSession: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ examId: 'exam-id' })
          .mockResolvedValueOnce({ id: 'waiting-session', examId: 'exam-id', status: SessionStatus.NOT_STARTED }),
      },
      answer: { upsert: vi.fn() },
    };
    const prisma = { $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)) };
    const service = new SessionsService(prisma as never, {} as never, {} as never);

    await expect(service.saveAnswer('waiting-session', {
      examQuestionId: 'question-1', responseData: 'answer',
    } as never)).rejects.toThrow('not accepting answers');
    expect(tx.answer.upsert).not.toHaveBeenCalled();
  });
});

describe('SessionsService deadline enforcement', () => {
  const makeSaveHarness = (endsAt: Date, count = 0, saveSucceeds = false, serverNow = endsAt) => {
    const finalizedSession = {
      id: 'session-id',
      examId: 'exam-id',
      status: count > 0 ? SessionStatus.SUBMITTED : SessionStatus.EXPIRED,
      endsAt,
      submittedAt: new Date(),
    };
    const tx = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{ id: 'exam-id' }])
        .mockResolvedValueOnce([{ id: 'session-id' }])
        .mockResolvedValueOnce(saveSucceeds ? [{ id: 'answer-id' }] : [])
        .mockResolvedValueOnce([{ now: serverNow }]),
      exam: { findUnique: vi.fn().mockResolvedValue({ status: ExamStatus.RELEASED }) },
      examSession: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ examId: 'exam-id' })
          .mockResolvedValueOnce({
            ...finalizedSession,
            status: SessionStatus.IN_PROGRESS,
          }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(finalizedSession),
        update: vi.fn(),
      },
      incident: { findFirst: vi.fn().mockResolvedValue(null) },
      examQuestion: { findUnique: vi.fn().mockResolvedValue({ id: 'question-id', examId: 'exam-id' }) },
      answer: {
        count: vi.fn().mockResolvedValue(count),
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn(),
        update: vi.fn(),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)),
    };
    return { service: new SessionsService(prisma as never, {} as never, {} as never), tx };
  };

  it('saves an answer before the deadline', async () => {
    const { service, tx } = makeSaveHarness(new Date(Date.now() + 60_000), 0, true);
    await expect(service.saveAnswer('session-id', {
      examQuestionId: 'question-id',
      responseData: 'option-id',
    } as never)).resolves.toEqual({ saved: true });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(tx.examSession.updateMany).not.toHaveBeenCalled();
  });

  it('does not change session status for an answer validation failure before the deadline', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
      exam: { findUnique: vi.fn().mockResolvedValue({ status: ExamStatus.RELEASED }) },
      examSession: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ examId: 'exam-id' })
          .mockResolvedValueOnce({
            id: 'session-id', examId: 'exam-id', status: SessionStatus.IN_PROGRESS,
            endsAt: new Date(Date.now() + 60_000),
          }),
        updateMany: vi.fn(),
        update: vi.fn(),
      },
      incident: { findFirst: vi.fn().mockResolvedValue(null) },
      examQuestion: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)),
    };
    const service = new SessionsService(prisma as never, {} as never, {} as never);

    await expect(service.saveAnswer('session-id', {
      examQuestionId: 'question-from-another-exam',
      responseData: 'answer',
    } as never)).rejects.toThrow('does not belong to the session exam');
    expect(tx.examSession.updateMany).not.toHaveBeenCalled();
    expect(tx.examSession.update).not.toHaveBeenCalled();
  });

  it('accepts a repeated answer save for the same question without transitioning the session', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'row' }]),
      exam: { findUnique: vi.fn().mockResolvedValue({ status: ExamStatus.RELEASED }) },
      examSession: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'session-id', examId: 'exam-id', status: SessionStatus.IN_PROGRESS,
          endsAt: new Date(Date.now() + 60_000),
        }),
        update: vi.fn(),
      },
      incident: { findFirst: vi.fn().mockResolvedValue(null) },
      examQuestion: { findUnique: vi.fn().mockResolvedValue({ id: 'question-id', examId: 'exam-id' }) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)),
    };
    const service = new SessionsService(prisma as never, {} as never, {} as never);
    const request = { examQuestionId: 'question-id', responseData: 'option-a' };

    await expect(service.saveAnswer('session-id', request as never)).resolves.toEqual({ saved: true });
    await expect(service.saveAnswer('session-id', request as never)).resolves.toEqual({ saved: true });
    expect(tx.examSession.update).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(6);
  });

  it('finalizes and rejects an answer save exactly at the deadline', async () => {
    const deadline = new Date('2026-10-14T12:00:00.000Z');
    const { service, tx } = makeSaveHarness(deadline);

    await expect(service.saveAnswer('session-id', {
      examQuestionId: 'question-id',
      responseData: 'late-option',
    } as never)).rejects.toThrow('deadline has passed');
    expect(tx.examSession.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.answer.upsert).not.toHaveBeenCalled();
  });

  it('rejects a late save when expiry finalization already won the conditional transition', async () => {
    const endsAt = new Date(Date.now() - 1);
    const { service, tx } = makeSaveHarness(endsAt, 0, false, new Date(Date.now() + 1));
    tx.examSession.updateMany.mockResolvedValue({ count: 0 });
    tx.examSession.findUniqueOrThrow.mockResolvedValue({
      id: 'session-id', examId: 'exam-id', status: SessionStatus.EXPIRED,
      endsAt: new Date(Date.now() - 1), submittedAt: new Date(),
    });

    await expect(service.saveAnswer('session-id', {
      examQuestionId: 'question-id',
      responseData: 'late-option',
    } as never)).rejects.toThrow('deadline has passed');
    expect(tx.answer.upsert).not.toHaveBeenCalled();
  });

  it('finalizes a late normal submission using the expiry path', async () => {
    const endsAt = new Date(Date.now() - 1);
    const finalized = {
      id: 'session-id', examId: 'exam-id', status: SessionStatus.SUBMITTED,
      endsAt, submittedAt: new Date(),
    };
    const tx = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{ id: 'exam-id' }])
        .mockResolvedValueOnce([{ id: 'session-id' }])
        .mockResolvedValueOnce([{ now: new Date() }]),
      exam: { findUnique: vi.fn().mockResolvedValue({ status: ExamStatus.RELEASED }) },
      examSession: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ examId: 'exam-id' })
          .mockResolvedValueOnce({ ...finalized, status: SessionStatus.IN_PROGRESS }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(finalized),
      },
      examQuestion: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { points: 5 } }),
        findMany: vi.fn().mockResolvedValue([{ type: QuestionType.MULTIPLE_CHOICE }]),
      },
      answer: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn()
          .mockResolvedValueOnce([]) // answers loaded for auto-grading
          .mockResolvedValueOnce([{ pointsAwarded: 3 }]), // committed summary snapshot
        update: vi.fn(),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)),
    };
    const service = new SessionsService(prisma as never, {} as never, {} as never);

    await expect(service.submit('session-id')).resolves.toMatchObject({ status: SessionStatus.SUBMITTED, score: 3 });
    expect(tx.examSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'session-id', status: SessionStatus.IN_PROGRESS, endsAt: { lte: expect.any(Date) } },
    }));
    expect(tx.answer.findMany).toHaveBeenCalledTimes(2);
  });

  it('keeps a late request against an already-finalized session idempotent and does not regrade it', async () => {
    const submittedAt = new Date('2026-10-14T10:00:00.000Z');
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
      exam: { findUnique: vi.fn().mockResolvedValue({ status: ExamStatus.CLOSED }) },
      examSession: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ examId: 'exam-id' })
          .mockResolvedValueOnce({
            id: 'session-id', examId: 'exam-id', status: SessionStatus.FORCE_SUBMITTED,
            endsAt: new Date(Date.now() - 1), submittedAt,
          }),
        updateMany: vi.fn(),
      },
      examQuestion: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { points: 5 } }),
        findMany: vi.fn().mockResolvedValue([{ type: QuestionType.MULTIPLE_CHOICE }]),
      },
      answer: { findMany: vi.fn().mockResolvedValue([{ pointsAwarded: 3 }]) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)),
    };
    const service = new SessionsService(prisma as never, {} as never, {} as never);

    await expect(service.submit('session-id')).resolves.toMatchObject({
      status: SessionStatus.FORCE_SUBMITTED,
      submittedAt,
    });
    expect(tx.examSession.updateMany).not.toHaveBeenCalled();
  });
});

describe('multiple-answer grading baseline', () => {
  const scoringService = () => {
    const { service } = createService();
    return service;
  };

  const score = (correct: unknown, response: unknown, count = 2) => {
    const service = scoringService();
    const calculate = Reflect.get(service, 'getScoreRatio') as (
      type: QuestionType,
      correctAnswer: unknown,
      responseData: unknown,
      correctAnswerCount: number,
    ) => number;
    return calculate.call(service, QuestionType.MULTIPLE_CHOICE, correct, response, count);
  };

  it('awards partial credit for selected correct answers and does not penalize extras', () => {
    expect(score(['a', 'b'], ['a'])).toBe(0.5);
    expect(score(['a', 'b'], ['a', 'wrong'])).toBe(0.5);
    expect(score(['a', 'b'], ['a', 'b', 'wrong'])).toBe(1);
  });

  it('does not inflate partial credit for duplicate response IDs', () => {
    expect(score(['a', 'b'], ['a', 'a'])).toBe(0.5);
  });

  it('returns zero for empty or malformed selections', () => {
    expect(score(['a', 'b'], [])).toBe(0);
    expect(score(['a', 'b'], 'a')).toBe(0);
    expect(score([], ['a'])).toBe(0);
  });

  it('uses unique stored correct IDs for the ratio denominator', () => {
    expect(score(['a', 'a', 'b'], ['a'])).toBe(0.5);
  });

  it('keeps full-correctness consistent with unique correct IDs while rejecting duplicate responses', () => {
    const service = scoringService();
    const isFullyCorrect = Reflect.get(service, 'isFullyCorrectAnswer') as (
      type: QuestionType,
      correctAnswer: unknown,
      responseData: unknown,
      correctAnswerCount: number,
    ) => boolean;
    expect(isFullyCorrect.call(service, QuestionType.MULTIPLE_CHOICE, ['a', 'a', 'b'], ['a', 'b'], 3)).toBe(true);
    expect(isFullyCorrect.call(service, QuestionType.MULTIPLE_CHOICE, ['a', 'b'], ['a', 'a', 'b'], 2)).toBe(false);
  });
});
