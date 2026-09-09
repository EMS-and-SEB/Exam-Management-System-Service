import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppException } from '../common/exceptions/app-exceptions.js';
import { QuestionType, StaffRole } from '../generated/prisma/client.js';
import { questionInputSchema, QuestionInput } from './validation/questions.dto.js';

interface ParentRef {
  courseId?: string;
  cohortId?: string;
}

interface CallerContext {
  staffId: string;
  role: StaffRole;
}

@Injectable()
export class QuestionsService {
  constructor(private readonly prisma: PrismaService) {}

  async createMany(parent: ParentRef, type: QuestionType, questions: QuestionInput[], caller: CallerContext) {
    await this.assertOwnsParent(parent, caller);

    const created = await this.prisma.question.createManyAndReturn({
      data: questions.map((q) => ({
        courseId: parent.courseId,
        cohortId: parent.cohortId,
        type,
        prompt: q.prompt,
        options: 'options' in q ? q.options : undefined,
        correctAnswer: 'correctAnswer' in q ? q.correctAnswer : undefined,
        points: q.points,
        createdById: caller.staffId,
      })),
    });

    return { questions: created };
  }

  async findAllForParent(parent: ParentRef, caller: CallerContext) {
    await this.assertOwnsParent(parent, caller);
    return this.prisma.question.findMany({
      where: { courseId: parent.courseId, cohortId: parent.cohortId, deletedAt: null },
    });
  }

  async findOne(questionId: string, caller: CallerContext) {
    const question = await this.getOwnedQuestion(questionId, caller);
    return question;
  }

  async update(questionId: string, patch: Partial<QuestionInput>, caller: CallerContext) {
    const question = await this.getOwnedQuestion(questionId, caller);

    const candidate = questionInputSchema.parse({
      type: question.type,
      prompt: patch.prompt ?? question.prompt,
      options: 'options' in patch ? patch.options : question.options,
      correctAnswer: 'correctAnswer' in patch ? patch.correctAnswer : question.correctAnswer,
      points: patch.points ?? question.points,
    });

    const data = {
      prompt: candidate.prompt,
      options: 'options' in candidate ? candidate.options : undefined,
      correctAnswer: 'correctAnswer' in candidate ? candidate.correctAnswer : undefined,
      points: candidate.points,
    };

    const usedInExam = await this.prisma.examQuestion.findFirst({ where: { sourceQuestionId: questionId } });

    if (question.cohortId && usedInExam) {
      return this.prisma.question.create({
        data: {
          cohortId: question.cohortId,
          type: question.type,
          createdById: question.createdById,
          ...data,
        },
      });
    }

    return this.prisma.question.update({ where: { id: questionId }, data });
  }

  async remove(questionId: string, caller: CallerContext) {
    await this.getOwnedQuestion(questionId, caller);

    const usedInExam = await this.prisma.examQuestion.findFirst({ where: { sourceQuestionId: questionId } });

    if (usedInExam) {
      await this.prisma.question.update({ where: { id: questionId }, data: { deletedAt: new Date() } });
    } else {
      await this.prisma.question.delete({ where: { id: questionId } });
    }
  }

  private async getOwnedQuestion(questionId: string, caller: CallerContext) {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      include: { course: true, cohort: true },
    });
    if (!question) throw AppException.notFound('Question not found.');

    const ownerId = question.course?.instructorId ?? question.cohort?.coordinatorId;
    if (ownerId !== caller.staffId) throw AppException.forbidden();

    return question;
  }

  private async assertOwnsParent(parent: ParentRef, caller: CallerContext) {
    if (parent.courseId) {
      const course = await this.prisma.course.findUnique({ where: { id: parent.courseId } });
      if (!course) throw AppException.notFound('Course not found.');
      if (course.instructorId !== caller.staffId) throw AppException.forbidden();
      if (course.status === 'ARCHIVED') {
        throw AppException.conflict('This course is archived — no new questions can be added.');
      }
      return;
    }

    if (parent.cohortId) {
      const cohort = await this.prisma.cohort.findUnique({ where: { id: parent.cohortId } });
      if (!cohort) throw AppException.notFound('Cohort not found.');
      if (cohort.coordinatorId !== caller.staffId) throw AppException.forbidden();
      if (cohort.status === 'ARCHIVED') {
        throw AppException.conflict('This cohort is archived — no new questions can be added.');
      }
      return;
    }

    throw AppException.badRequest('Either courseId or cohortId must be provided.');
  }
}
