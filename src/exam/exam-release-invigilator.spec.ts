import { ExamStatus, StaffRole } from '../generated/prisma/client.js';
import { ExamService } from './exam.service.js';

function makeHarness(hasConflict: boolean) {
  const scheduledStart = new Date(Date.now() + 60 * 60_000);
  const exam = {
    id: 'exam-id',
    courseId: 'course-id',
    cohortId: null,
    status: ExamStatus.DRAFT,
    scheduledStart,
    durationMinutes: 60,
    course: { instructorId: 'instructor-id' },
  };
  const tx = {
    $queryRaw: vi.fn((query: { sql?: string }) =>
      Promise.resolve(
        query.sql?.includes('INNER JOIN "Exam"') && hasConflict
          ? [{ id: 'other-exam-id', title: 'Other exam' }]
          : [],
      ),
    ),
    exam: {
      findUnique: vi.fn().mockResolvedValue(exam),
      update: vi.fn().mockResolvedValue({ ...exam, status: ExamStatus.RELEASED }),
    },
    course: { findUnique: vi.fn().mockResolvedValue({ status: 'ACTIVE', instructorId: 'instructor-id' }) },
    examInvigilator: { findFirst: vi.fn().mockResolvedValue({ invigilatorId: 'invigilator-id' }) },
    enrollment: { findMany: vi.fn().mockResolvedValue([]) },
    cohortMember: { findMany: vi.fn().mockResolvedValue([]) },
    examRoster: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    examOTP: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    exam: { findUnique: vi.fn().mockResolvedValue(exam) },
    course: { findUnique: vi.fn().mockResolvedValue({ instructorId: 'instructor-id' }) },
    $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)),
  };
  const auditService = { log: vi.fn().mockResolvedValue(undefined) };
  const service = new ExamService(prisma as never, auditService as never, {} as never, {} as never);
  return { service, tx, auditService };
}

describe('ExamService invigilator overlap validation on release', () => {
  const caller = { staffId: 'instructor-id', role: StaffRole.INSTRUCTOR };

  it('rejects release when the assigned invigilator has an overlapping released exam', async () => {
    const { service, tx, auditService } = makeHarness(true);

    await expect(service.release('exam-id', caller)).rejects.toThrow(
      'This invigilator is already assigned to an active exam scheduled during this time.',
    );

    expect(tx.examOTP.create).not.toHaveBeenCalled();
    expect(tx.exam.update).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('releases when the assigned invigilator has no overlapping released exam', async () => {
    const { service, tx, auditService } = makeHarness(false);

    await expect(service.release('exam-id', caller)).resolves.toMatchObject({
      exam: { status: ExamStatus.RELEASED },
    });

    const lockStaffIndex = tx.$queryRaw.mock.calls.findIndex(([query]) => query.sql?.includes('"StaffAccount"'));
    const overlapCheckIndex = tx.$queryRaw.mock.calls.findIndex(([query]) => query.sql?.includes('INNER JOIN "Exam"'));
    expect(lockStaffIndex).toBeGreaterThanOrEqual(0);
    expect(overlapCheckIndex).toBeGreaterThan(lockStaffIndex);
    expect(tx.examOTP.create).toHaveBeenCalledTimes(1);
    expect(auditService.log).toHaveBeenCalledTimes(1);
  });
});
