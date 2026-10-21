import { QuestionType, SessionStatus, StaffRole } from '../generated/prisma/client.js';
import { GradingService } from './grading.service.js';

const instructor = {
  sub: 'instructor-id',
  sid: 'session-id',
  role: StaffRole.INSTRUCTOR,
  orgUnitId: 'org-unit-id',
};

function makeService(type: QuestionType) {
  const answer = {
    id: 'answer-id',
    examQuestion: { type, points: 5 },
    session: {
      status: SessionStatus.SUBMITTED,
      exam: {
        course: { instructorId: instructor.sub },
        cohort: null,
      },
    },
  };
  const prisma = {
    answer: {
      findUnique: vi.fn().mockResolvedValue(answer),
      update: vi.fn().mockResolvedValue({
        id: answer.id,
        pointsAwarded: 3,
        gradedById: instructor.sub,
        gradedAt: new Date(),
      }),
    },
  };
  return { service: new GradingService(prisma as never, {} as never), prisma };
}

describe('GradingService manual grading restrictions', () => {
  it('rejects manual grading of automatically graded question types', async () => {
    const { service, prisma } = makeService(QuestionType.MULTIPLE_CHOICE);

    await expect(service.gradeAnswer('answer-id', { pointsAwarded: 3 }, instructor))
      .rejects.toThrow('Only workout answers can be manually graded.');
    expect(prisma.answer.update).not.toHaveBeenCalled();
  });

  it('allows authorized grading of terminal-session workout answers', async () => {
    const { service, prisma } = makeService(QuestionType.WORKOUT);

    await expect(service.gradeAnswer('answer-id', { pointsAwarded: 3 }, instructor))
      .resolves.toMatchObject({ answer: { pointsAwarded: 3, gradedById: instructor.sub } });
    expect(prisma.answer.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'answer-id' },
      data: expect.objectContaining({ pointsAwarded: 3, gradedById: instructor.sub }),
    }));
  });
});
