import { ExamStatus, QuestionType, StaffRole } from '../generated/prisma/client.js';
import { ExamService } from './exam.service.js';

function makeHarness(pendingManualAnswer: boolean) {
  const exam = {
    id: 'exam-id',
    courseId: 'course-id',
    cohortId: null,
    status: ExamStatus.RELEASED,
    course: { instructorId: 'instructor-id' },
  };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    exam: {
      findUnique: vi.fn().mockResolvedValue({ status: ExamStatus.RELEASED }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ ...exam, status: ExamStatus.CLOSED }),
    },
    answer: { findFirst: vi.fn().mockResolvedValue(pendingManualAnswer ? { id: 'answer-id' } : null) },
  };
  const prisma = {
    exam: { findUnique: vi.fn().mockResolvedValue(exam) },
    course: { findUnique: vi.fn().mockResolvedValue({ instructorId: 'instructor-id' }) },
    $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)),
  };
  const sessionsService = { forceSubmitForExam: vi.fn().mockResolvedValue([]) };
  const auditService = { log: vi.fn().mockResolvedValue(undefined) };
  const service = new ExamService(
    prisma as never,
    auditService as never,
    {} as never,
    sessionsService as never,
  );
  return { service, tx, sessionsService, auditService };
}

describe('ExamService manual-grading close rule', () => {
  const caller = { staffId: 'instructor-id', role: StaffRole.INSTRUCTOR };

  it('blocks closure while a workout answer remains ungraded', async () => {
    const { service, tx, sessionsService, auditService } = makeHarness(true);

    await expect(service.close('exam-id', caller)).rejects.toThrow('All manually-graded answers must be graded');
    expect(tx.exam.updateMany).not.toHaveBeenCalled();
    expect(sessionsService.forceSubmitForExam).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('closes normally when no workout answers are pending', async () => {
    const { service, tx, sessionsService, auditService } = makeHarness(false);

    await expect(service.close('exam-id', caller)).resolves.toMatchObject({ status: ExamStatus.CLOSED });
    expect(tx.answer.findFirst).toHaveBeenCalledWith({
      where: { examQuestion: { examId: 'exam-id', type: QuestionType.WORKOUT }, gradedAt: null },
      select: { id: true },
    });
    expect(sessionsService.forceSubmitForExam).toHaveBeenCalledWith('exam-id', tx);
    expect(auditService.log).toHaveBeenCalledTimes(1);
  });
});
