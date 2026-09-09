import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppException } from '../common/exceptions/app-exceptions.js';
import { QuestionType, StaffRole } from '../generated/prisma/client.js';
import type { CreateQuestionsDto, UpdateQuestionDto } from './validation/questions.dto.js';

@Injectable()
export class QuestionsService {
  constructor(private readonly prisma: PrismaService) {}

  async createForCourse(courseId: string, userId: string, dto: CreateQuestionsDto) {
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw AppException.notFound('Course not found.');
    if (course.instructorId !== userId) throw AppException.forbidden();
    const type = dto.type as QuestionType;
    dto.questions.forEach((q) => this.validateQuestion(type, q));
    const questions = await this.prisma.$transaction(dto.questions.map((q) => this.prisma.question.create({
      data: { courseId, cohortId: null, type, prompt: q.prompt, options: q.options as any, correctAnswer: q.correctAnswer as any, points: q.points, createdById: userId },
    })));
    return questions;
  }

  async listForCourse(courseId: string, userId: string) {
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw AppException.notFound('Course not found.');
    if (course.instructorId !== userId) throw AppException.forbidden();
    return this.prisma.question.findMany({ where: { courseId, deletedAt: null }, orderBy: { createdAt: 'asc' } });
  }

  async createForCohort(cohortId: string, userId: string, dto: CreateQuestionsDto) {
    const cohort = await this.prisma.cohort.findUnique({ where: { id: cohortId } });
    if (!cohort) throw AppException.notFound('Cohort not found.');
    if (cohort.coordinatorId !== userId) throw AppException.forbidden();
    const type = dto.type as QuestionType;
    dto.questions.forEach((q) => this.validateQuestion(type, q));
    const questions = await this.prisma.$transaction(dto.questions.map((q) => this.prisma.question.create({
      data: { cohortId, courseId: null, type, prompt: q.prompt, options: q.options as any, correctAnswer: q.correctAnswer as any, points: q.points, createdById: userId },
    })));
    return questions;
  }

  async listForCohort(cohortId: string, userId: string) {
    const cohort = await this.prisma.cohort.findUnique({ where: { id: cohortId } });
    if (!cohort) throw AppException.notFound('Cohort not found.');
    if (cohort.coordinatorId !== userId) throw AppException.forbidden();
    return this.prisma.question.findMany({ where: { cohortId, deletedAt: null }, orderBy: { createdAt: 'asc' } });
  }

  async get(questionId: string, userId: string, role: StaffRole) {
    const question = await this.prisma.question.findUnique({ where: { id: questionId } });
    if (!question || question.deletedAt) throw AppException.notFound('Question not found.');
    await this.assertOwner(question, userId, role);
    return question;
  }

  async update(questionId: string, userId: string, role: StaffRole, dto: UpdateQuestionDto) {
    const question = await this.prisma.question.findUnique({ where: { id: questionId } });
    if (!question || question.deletedAt) throw AppException.notFound('Question not found.');
    await this.assertOwner(question, userId, role);

    const next = {
      prompt: dto.prompt ?? question.prompt,
      options: dto.options !== undefined ? dto.options : question.options,
      correctAnswer: dto.correctAnswer !== undefined ? dto.correctAnswer : question.correctAnswer,
      points: dto.points ?? question.points,
    };
    this.validateQuestion(question.type, next);

    const used = await this.prisma.examQuestion.findFirst({ where: { sourceQuestionId: questionId }, select: { id: true } });
    if (used) {
      const replacement = await this.prisma.question.create({
        data: {
          courseId: question.courseId,
          cohortId: question.cohortId,
          type: question.type,
          prompt: next.prompt,
          options: next.options as any,
          correctAnswer: next.correctAnswer as any,
          points: next.points,
          createdById: userId,
        },
      });
      return replacement;
    }

    return this.prisma.question.update({
      where: { id: questionId },
      data: { prompt: next.prompt, options: next.options as any, correctAnswer: next.correctAnswer as any, points: next.points },
    });
  }

  async remove(questionId: string, userId: string, role: StaffRole) {
    const question = await this.prisma.question.findUnique({ where: { id: questionId } });
    if (!question || question.deletedAt) throw AppException.notFound('Question not found.');
    await this.assertOwner(question, userId, role);
    const used = await this.prisma.examQuestion.findFirst({ where: { sourceQuestionId: questionId }, select: { id: true } });
    if (used) await this.prisma.question.update({ where: { id: questionId }, data: { deletedAt: new Date() } });
    else await this.prisma.question.delete({ where: { id: questionId } });
  }

  private async assertOwner(question: any, userId: string, role: StaffRole) {
    if (question.courseId) {
      const course = await this.prisma.course.findUnique({ where: { id: question.courseId }, select: { instructorId: true } });
      if (role !== StaffRole.INSTRUCTOR || !course || course.instructorId !== userId) throw AppException.forbidden();
      return;
    }
    if (question.cohortId) {
      const cohort = await this.prisma.cohort.findUnique({ where: { id: question.cohortId }, select: { coordinatorId: true } });
      if (role !== StaffRole.EXIT_EXAM_COORDINATOR || !cohort || cohort.coordinatorId !== userId) throw AppException.forbidden();
      return;
    }
    throw AppException.forbidden();
  }

  private validateQuestion(type: QuestionType, q: { prompt: string; options?: unknown; correctAnswer?: unknown; points: number }) {
    if (!Number.isInteger(q.points) || q.points <= 0) throw AppException.badRequest('Points must be a positive integer.');
    if (!q.prompt?.trim()) throw AppException.badRequest('Prompt is required.');

    const isObject = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
    const options = q.options as any;
    const answer = q.correctAnswer as any;
    const optionIds = (items: any[]) => new Set(items.map((x) => x?.id));

    switch (type) {
      case QuestionType.TRUE_FALSE:
        if (typeof answer !== 'boolean') throw AppException.badRequest('TRUE_FALSE correctAnswer must be boolean.');
        break;
      case QuestionType.MULTIPLE_CHOICE:
        if (!Array.isArray(options) || options.length < 2 || options.some((x) => !x?.id || typeof x.text !== 'string')) throw AppException.badRequest('MULTIPLE_CHOICE options must be [{id,text}] with at least two options.');
        if (typeof answer !== 'string' || !optionIds(options).has(answer)) throw AppException.badRequest('MULTIPLE_CHOICE correctAnswer must be an option id.');
        break;
      case QuestionType.MULTIPLE_SELECT:
        if (!Array.isArray(options) || options.length < 2 || options.some((x) => !x?.id || typeof x.text !== 'string')) throw AppException.badRequest('MULTIPLE_SELECT options must be [{id,text}] with at least two options.');
        if (!Array.isArray(answer) || !answer.length || answer.some((id) => typeof id !== 'string' || !optionIds(options).has(id))) throw AppException.badRequest('MULTIPLE_SELECT correctAnswer must be an array of option ids.');
        break;
      case QuestionType.MATCHING:
        if (!isObject(options) || !Array.isArray(options.left) || !Array.isArray(options.right) || options.left.length < 1 || options.right.length < 1 || [...options.left, ...options.right].some((x) => !x?.id || typeof x.text !== 'string')) throw AppException.badRequest('MATCHING options must contain left and right [{id,text}] lists.');
        if (!Array.isArray(answer) || answer.some((p) => !p?.leftId || !p?.rightId)) throw AppException.badRequest('MATCHING correctAnswer must be [{leftId,rightId}].');
        if (answer.some((p) => !optionIds(options.left).has(p.leftId) || !optionIds(options.right).has(p.rightId))) throw AppException.badRequest('MATCHING answers must reference valid option ids.');
        break;
      case QuestionType.FILL_BLANK:
        const blanks = [...q.prompt.matchAll(/\{\{\d+\}\}/g)].length;
        if (!blanks) throw AppException.badRequest('FILL_BLANK prompt must contain blanks such as {{1}}.');
        if (!Array.isArray(answer) || answer.length !== blanks || answer.some((a) => !Array.isArray(a) || a.length < 1 || a.some((v) => typeof v !== 'string'))) throw AppException.badRequest('FILL_BLANK correctAnswer must contain accepted answers for each blank.');
        break;
      case QuestionType.WORKOUT:
        if (q.options !== undefined && q.options !== null) throw AppException.badRequest('WORKOUT questions do not use options.');
        if (q.correctAnswer !== undefined && q.correctAnswer !== null) throw AppException.badRequest('WORKOUT questions do not use correctAnswer.');
        break;
    }
  }
}
