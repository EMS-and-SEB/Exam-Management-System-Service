import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditAction } from '../audit/audit.const.js';
import { AppException } from '../common/exceptions/app-exceptions.js';
import { generateOtp } from '../auth/utils/token.util.js';
import { StaffRole, ExamStatus, ExamType } from '../generated/prisma/client.js';

interface CallerContext {
  staffId: string;
  role: StaffRole;
}

@Injectable()
export class ExamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    dto: { examType: ExamType; title: string; courseId?: string; cohortId?: string; durationMinutes?: number; scheduledStart?: Date },
    caller: CallerContext,
  ) {
    if (dto.courseId) {
      const course = await this.prisma.course.findUnique({ where: { id: dto.courseId } });
      if (!course) throw AppException.notFound('Course not found.');
      if (caller.role !== StaffRole.INSTRUCTOR || course.instructorId !== caller.staffId) throw AppException.forbidden();
    } else {
      const cohort = await this.prisma.cohort.findUnique({ where: { id: dto.cohortId! } });
      if (!cohort) throw AppException.notFound('Cohort not found.');
      if (caller.role !== StaffRole.EXIT_EXAM_COORDINATOR || cohort.coordinatorId !== caller.staffId) throw AppException.forbidden();
    }

    return this.prisma.$transaction(async (tx) => {
      const exam = await tx.exam.create({
        data: {
          examType: dto.examType,
          title: dto.title,
          courseId: dto.courseId,
          cohortId: dto.cohortId,
          durationMinutes: dto.durationMinutes,
          scheduledStart: dto.scheduledStart,
          createdById: caller.staffId,
        },
      });
      await tx.examInvigilator.create({ data: { examId: exam.id, invigilatorId: caller.staffId } });
      return exam;
    });
  }

  findAll(caller: CallerContext) {
    return this.prisma.exam.findMany({ where: this.buildAccessWhere(caller) });
  }

  findOne(id: string, caller: CallerContext) {
    return this.getAccessibleExam(id, caller);
  }

  async update(id: string, data: { title?: string; durationMinutes?: number; scheduledStart?: Date }, caller: CallerContext) {
    await this.assertOwnsExam(id, caller, ExamStatus.DRAFT);
    return this.prisma.exam.update({ where: { id }, data });
  }

  async remove(id: string, caller: CallerContext) {
    await this.assertOwnsExam(id, caller, ExamStatus.DRAFT);
    await this.prisma.exam.delete({ where: { id } });
  }

  async listQuestions(examId: string, caller: CallerContext) {
    await this.assertOwnsExam(examId, caller);
    return this.prisma.examQuestion.findMany({ where: { examId }, orderBy: { order: 'asc' } });
  }

  async attachQuestions(examId: string, questionIds: string[], caller: CallerContext) {
    const exam = await this.assertOwnsExam(examId, caller, ExamStatus.DRAFT);

    const sourceQuestions = await this.prisma.question.findMany({ where: { id: { in: questionIds }, deletedAt: null } });
    if (sourceQuestions.length !== questionIds.length) throw AppException.badRequest('One or more questions were not found.');

    const mismatched = sourceQuestions.some(
      (q) => (exam.courseId && q.courseId !== exam.courseId) || (exam.cohortId && q.cohortId !== exam.cohortId),
    );
    if (mismatched) throw AppException.badRequest('Questions must belong to the same course or cohort as the exam.');

    const currentCount = await this.prisma.examQuestion.count({ where: { examId } });

    const created = await this.prisma.examQuestion.createManyAndReturn({
      data: sourceQuestions.map((q, index) => ({
        examId,
        sourceQuestionId: q.id,
        type: q.type,
        prompt: q.prompt,
        options: q.options ?? undefined,
        correctAnswer: q.correctAnswer ?? undefined,
        points: q.points,
        order: currentCount + index + 1,
      })),
    });

    return { questions: created };
  }

  async detachQuestion(examId: string, questionId: string, caller: CallerContext) {
    await this.assertOwnsExam(examId, caller, ExamStatus.DRAFT);
    const link = await this.prisma.examQuestion.findFirst({ where: { examId, id: questionId } });
    if (!link) throw AppException.notFound('Question is not attached to this exam.');
    await this.prisma.examQuestion.delete({ where: { id: link.id } });
  }

  async assignInvigilator(examId: string, invigilatorId: string, caller: CallerContext) {
    await this.assertOwnsExam(examId, caller, ExamStatus.DRAFT);

    const staff = await this.prisma.staffAccount.findUnique({ where: { id: invigilatorId } });
    if (!staff || !staff.isActive) throw AppException.badRequest('Invalid invigilator.');

    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.examInvigilator.findFirst({ where: { examId } });
      if (previous) {
        await tx.examInvigilator.deleteMany({ where: { examId } });
        await this.auditService.log(
          { actorId: caller.staffId, action: AuditAction.INVIGILATOR_REMOVED, entityType: 'StaffAccount', entityId: previous.invigilatorId, metadata: { examId } },
          tx,
        );
      }
      const assignment = await tx.examInvigilator.create({ data: { examId, invigilatorId } });
      await this.auditService.log(
        { actorId: caller.staffId, action: AuditAction.INVIGILATOR_ASSIGNED, entityType: 'StaffAccount', entityId: invigilatorId, metadata: { examId } },
        tx,
      );
      return assignment;
    });
  }

  async removeInvigilator(examId: string, staffId: string, caller: CallerContext) {
    await this.assertOwnsExam(examId, caller, ExamStatus.DRAFT);
    const assignment = await this.prisma.examInvigilator.findFirst({ where: { examId, invigilatorId: staffId } });
    if (!assignment) throw AppException.notFound('Invigilator assignment not found.');

    await this.prisma.$transaction(async (tx) => {
      await tx.examInvigilator.delete({ where: { id: assignment.id } });
      await this.auditService.log(
        { actorId: caller.staffId, action: AuditAction.INVIGILATOR_REMOVED, entityType: 'StaffAccount', entityId: staffId, metadata: { examId } },
        tx,
      );
    });
  }

  async release(examId: string, caller: CallerContext) {
    const exam = await this.assertOwnsExam(examId, caller, ExamStatus.DRAFT);

    const rosterStudentIds = exam.courseId
      ? (await this.prisma.enrollment.findMany({ where: { courseId: exam.courseId, deletedAt: null }, select: { studentId: true } })).map((e) => e.studentId)
      : (await this.prisma.cohortMember.findMany({ where: { cohortId: exam.cohortId! }, select: { studentId: true } })).map((m) => m.studentId);

    const otp = generateOtp();
    const otpExpiresAt = new Date(exam.scheduledStart!.getTime() + (exam.durationMinutes ?? 180) * 60 * 1000);
    const [, , updatedExam] = await this.prisma.$transaction([
      this.prisma.examRoster.createMany({ data: rosterStudentIds.map((studentId) => ({ examId, studentId })) }),
      this.prisma.examOTP.create({ data: { examId, code: otp, expiresAt: otpExpiresAt } }),
      this.prisma.exam.update({ where: { id: examId }, data: { status: ExamStatus.RELEASED, releasedAt: new Date() } }),
    ]);

    await this.auditService.log({ actorId: caller.staffId, action: AuditAction.EXAM_RELEASED, entityType: 'Exam', entityId: examId });
    return { exam: updatedExam, otpExpiresAt };
  }

  async close(examId: string, caller: CallerContext) {
    await this.assertOwnsExam(examId, caller, ExamStatus.RELEASED);

    const ungraded = await this.prisma.answer.findFirst({ where: { examQuestion: { examId, type: 'WORKOUT' }, gradedAt: null } });
    if (ungraded) throw AppException.conflict('All manually-graded answers must be graded before closing this exam.');

    const closed = await this.prisma.exam.update({ where: { id: examId }, data: { status: ExamStatus.CLOSED, closedAt: new Date() } });
    await this.auditService.log({ actorId: caller.staffId, action: AuditAction.EXAM_CLOSED, entityType: 'Exam', entityId: examId });
    return closed;
  }

  async getOtp(examId: string, staffId: string) {
    await this.assertIsAssignedInvigilator(examId, staffId);

    const exam = await this.prisma.exam.findUniqueOrThrow({ where: { id: examId } });
    const visibleFrom = new Date(exam.scheduledStart!.getTime() - 5 * 60 * 1000);
    if (new Date() < visibleFrom) {
      throw AppException.forbidden(`The OTP will be visible starting ${visibleFrom.toISOString()}.`);
    }

    const otp = await this.prisma.examOTP.findUnique({ where: { examId } });
    if (!otp) throw AppException.notFound('This exam has not been released yet.');
    return { otp: otp.code, expiresAt: otp.expiresAt };
  }

  async getRoster(examId: string, staffId: string) {
    await this.assertIsAssignedInvigilator(examId, staffId);
    return this.prisma.examSession.findMany({ where: { examId }, include: { student: true } });
  }

  private buildAccessWhere(caller: CallerContext) {
    if (caller.role === StaffRole.INSTRUCTOR) return { course: { instructorId: caller.staffId } };
    if (caller.role === StaffRole.EXIT_EXAM_COORDINATOR) return { cohort: { coordinatorId: caller.staffId } };
    return { examInvigilators: { some: { invigilatorId: caller.staffId } } };
  }

  private async getAccessibleExam(examId: string, caller: CallerContext) {
    const exam = await this.prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) throw AppException.notFound('Exam not found.');

    const isPotentialOwner =
      (caller.role === StaffRole.INSTRUCTOR && exam.courseId) ||
      (caller.role === StaffRole.EXIT_EXAM_COORDINATOR && exam.cohortId);

    if (isPotentialOwner) {
      const ownerId = exam.courseId
        ? (await this.prisma.course.findUnique({ where: { id: exam.courseId } }))?.instructorId
        : (await this.prisma.cohort.findUnique({ where: { id: exam.cohortId! } }))?.coordinatorId;
      if (ownerId === caller.staffId) return exam;
    }

    const assignment = await this.prisma.examInvigilator.findFirst({ where: { examId, invigilatorId: caller.staffId } });
    if (!assignment) throw AppException.forbidden();

    return exam;
  }

  private async assertOwnsExam(examId: string, caller: CallerContext, requiredStatus?: ExamStatus) {
    const exam = await this.prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) throw AppException.notFound('Exam not found.');

    const ownsAsInstructor =
      caller.role === StaffRole.INSTRUCTOR &&
      exam.courseId &&
      (await this.prisma.course.findUnique({ where: { id: exam.courseId } }))?.instructorId === caller.staffId;

    const ownsAsCoordinator =
      caller.role === StaffRole.EXIT_EXAM_COORDINATOR &&
      exam.cohortId &&
      (await this.prisma.cohort.findUnique({ where: { id: exam.cohortId } }))?.coordinatorId === caller.staffId;

    if (!ownsAsInstructor && !ownsAsCoordinator) throw AppException.forbidden();
    if (requiredStatus && exam.status !== requiredStatus) {
      throw AppException.conflict(`This action requires the exam to be in ${requiredStatus} status.`);
    }
    return exam;
  }

  private async assertIsAssignedInvigilator(examId: string, staffId: string) {
    const assignment = await this.prisma.examInvigilator.findFirst({ where: { examId, invigilatorId: staffId } });
    if (!assignment) throw AppException.forbidden();
  }
}