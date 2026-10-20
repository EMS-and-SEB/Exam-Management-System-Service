import { Injectable } from '@nestjs/common';
import { AuditAction } from '../audit/audit.const.js';
import { AuditService } from '../audit/audit.service.js';
import { generateOtp } from '../auth/utils/token.util.js';
import { AppException } from '../common/exceptions/app-exceptions.js';
import {
  ExamStatus,
  ExamType,
  Prisma,
  QuestionType,
  SessionStatus,
  StaffRole,
} from '../generated/prisma/client.js';
import { OrgUnitsService } from '../org-units/org-units.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SessionsService } from '../sessions/sessions.service.js';

interface CallerContext {
  staffId: string;
  role: StaffRole;
}

interface ScopedCallerContext extends CallerContext {
  orgUnitId: string;
}

const ASSIGNABLE_INVIGILATOR_ROLES = [
  StaffRole.INVIGILATOR,
  StaffRole.INSTRUCTOR,
  StaffRole.EXIT_EXAM_COORDINATOR,
] as const;

function isAssignableInvigilatorRole(role: StaffRole) {
  return ASSIGNABLE_INVIGILATOR_ROLES.some(
    (assignableRole) => assignableRole === role,
  );
}

function isInvigilatorAssignable(
  exam: { status: ExamStatus; scheduledStart: Date | null },
  now = new Date(),
): boolean {
  const isOpen =
    exam.status === ExamStatus.DRAFT || exam.status === ExamStatus.RELEASED;
  return isOpen && (exam.scheduledStart === null || exam.scheduledStart > now);
}

@Injectable()
export class ExamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly orgUnitsService: OrgUnitsService,
    private readonly sessionsService: SessionsService,
  ) {}

  async create(
    dto: {
      examType: ExamType;
      title: string;
      courseId?: string;
      cohortId?: string;
      durationMinutes?: number;
      scheduledStart?: Date;
    },
    caller: CallerContext,
  ) {
    if (
      caller.role === StaffRole.INSTRUCTOR &&
      dto.examType === ExamType.MOCK_EXIT
    ) {
      throw AppException.forbidden();
    }
    if (
      caller.role === StaffRole.EXIT_EXAM_COORDINATOR &&
      dto.examType !== ExamType.MOCK_EXIT
    ) {
      throw AppException.forbidden();
    }

    if (dto.courseId) {
      const course = await this.prisma.course.findUnique({
        where: { id: dto.courseId },
      });
      if (!course) throw AppException.notFound('Course not found.');
      if (course.status === 'ARCHIVED') {
        throw AppException.conflict('Cannot create an exam for an archived course.');
      }
      if (
        caller.role !== StaffRole.INSTRUCTOR ||
        course.instructorId !== caller.staffId
      )
        throw AppException.forbidden();
    } else {
      const cohort = await this.prisma.cohort.findUnique({
        where: { id: dto.cohortId! },
      });
      if (!cohort) throw AppException.notFound('Cohort not found.');
      if (cohort.status === 'ARCHIVED') {
        throw AppException.conflict('Cannot create an exam for an archived cohort.');
      }
      if (
        caller.role !== StaffRole.EXIT_EXAM_COORDINATOR ||
        cohort.coordinatorId !== caller.staffId
      )
        throw AppException.forbidden();
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.courseId) {
        await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "Course" WHERE id = ${dto.courseId} FOR UPDATE`);
        const currentCourse = await tx.course.findUnique({ where: { id: dto.courseId } });
        if (!currentCourse || currentCourse.status !== 'ACTIVE') {
          throw AppException.conflict('Cannot create an exam for an archived course.');
        }
        if (currentCourse.instructorId !== caller.staffId) throw AppException.forbidden();
      } else if (dto.cohortId) {
        await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "Cohort" WHERE id = ${dto.cohortId} FOR UPDATE`);
        const currentCohort = await tx.cohort.findUnique({ where: { id: dto.cohortId } });
        if (!currentCohort || currentCohort.status !== 'ACTIVE') {
          throw AppException.conflict('Cannot create an exam for an archived cohort.');
        }
        if (currentCohort.coordinatorId !== caller.staffId) throw AppException.forbidden();
      }
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
      await tx.examInvigilator.create({
        data: { examId: exam.id, invigilatorId: caller.staffId },
      });
      return exam;
    });
  }

  async findAll(
    caller: CallerContext,
    scope: { courseId?: string; cohortId?: string } = {},
  ) {
    const exams = await this.prisma.exam.findMany({
      where: {
        AND: [
          this.buildAccessWhere(caller),
          { dataPurgedAt: null },
          ...(scope.courseId ? [{ courseId: scope.courseId }] : []),
          ...(scope.cohortId ? [{ cohortId: scope.cohortId }] : []),
        ],
      },
      include: {
        course: { select: { name: true } },
        cohort: { select: { name: true } },
      },
    });

    const maxScoreRows = await this.prisma.examQuestion.groupBy({
      by: ['examId'],
      where: { examId: { in: exams.map((exam) => exam.id) } },
      _sum: { points: true },
    });
    const maxScoreByExam = new Map(
      maxScoreRows.map((row) => [row.examId, row._sum.points ?? 0]),
    );

    const ungradedAnswers = await this.prisma.answer.findMany({
      where: {
        gradedAt: null,
        examQuestion: {
          examId: { in: exams.map((e) => e.id) },
          type: QuestionType.WORKOUT,
        },
        session: {
          status: {
            in: [
              SessionStatus.SUBMITTED,
              SessionStatus.FORCE_SUBMITTED,
              SessionStatus.EXPIRED,
            ],
          },
        },
      },
      select: { examQuestion: { select: { examId: true } } },
    });

    const pendingGradingByExam = new Map<string, number>();
    for (const a of ungradedAnswers) {
      const id = a.examQuestion.examId;
      pendingGradingByExam.set(id, (pendingGradingByExam.get(id) ?? 0) + 1);
    }

    return exams.map((exam) => ({
      ...exam,
      maxScore: maxScoreByExam.get(exam.id) ?? 0,
      pendingGradingCount: pendingGradingByExam.get(exam.id) ?? 0,
    }));
  }

  async findOne(id: string, caller: CallerContext) {
    const exam = await this.getAccessibleExam(id, caller);
    const assignment = await this.prisma.examInvigilator.findFirst({
      where: { examId: id },
      select: { invigilator: { select: { id: true, name: true } } },
    });
    return { ...exam, invigilator: assignment?.invigilator ?? null };
  }

  async listForInvigilatorAssignment(caller: ScopedCallerContext) {
    const scopedOrgUnitIds = await this.orgUnitsService.getScopedIds(
      caller.orgUnitId,
    );

    const exams = await this.prisma.exam.findMany({
      where: {
        dataPurgedAt: null,
        status: { in: [ExamStatus.DRAFT, ExamStatus.RELEASED] },
        OR: [
          { course: { orgUnitId: { in: scopedOrgUnitIds }, status: 'ACTIVE' } },
          { cohort: { orgUnitId: { in: scopedOrgUnitIds }, status: 'ACTIVE' } },
        ],
      },
      orderBy: { scheduledStart: 'asc' },
      select: {
        id: true,
        title: true,
        examType: true,
        status: true,
        scheduledStart: true,
        createdById: true,
        course: { select: { name: true } },
        cohort: { select: { name: true } },
        examInvigilators: {
          select: { invigilator: { select: { id: true, name: true } } },
        },
      },
    });

    const now = new Date();
    return exams
      .filter((exam) => isInvigilatorAssignable(exam, now))
      .map(({ examInvigilators, ...exam }) => ({
        ...exam,
        invigilator: examInvigilators[0]?.invigilator ?? null,
      }));
  }

  async listAssignedInvigilationExams(staffId: string) {
    return this.prisma.exam.findMany({
      where: {
        dataPurgedAt: null,
        examInvigilators: { some: { invigilatorId: staffId } },
      },
      orderBy: { scheduledStart: 'asc' },
      include: {
        course: { select: { name: true } },
        cohort: { select: { name: true } },
      },
    });
  }

  async getAssignedInvigilationExam(examId: string, staffId: string) {
    await this.assertIsAssignedInvigilator(examId, staffId);
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId, dataPurgedAt: null },
      include: {
        course: { select: { name: true } },
        cohort: { select: { name: true } },
      },
    });
    if (!exam) throw AppException.notFound('Exam not found.');
    return exam;
  }

  async update(
    id: string,
    data: { title?: string; durationMinutes?: number; scheduledStart?: Date },
    caller: CallerContext,
  ) {
    const exam = await this.assertOwnsExam(id, caller, ExamStatus.DRAFT);
    return this.prisma.$transaction(async (tx) => {
      await this.lockActiveParent(tx, exam, caller);
      const current = await tx.exam.findUnique({ where: { id }, select: { status: true } });
      if (!current || current.status !== ExamStatus.DRAFT) {
        throw AppException.conflict('This action requires the exam to be in DRAFT status.');
      }
      await tx.exam.update({ where: { id }, data });
      return tx.exam.findUniqueOrThrow({ where: { id } });
    });
  }

  async remove(id: string, caller: CallerContext) {
    await this.assertOwnsExam(id, caller, ExamStatus.DRAFT);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "Exam" WHERE id = ${id} FOR UPDATE`);
      const current = await tx.exam.findUnique({ where: { id }, select: { status: true } });
      if (!current || current.status !== ExamStatus.DRAFT) {
        throw AppException.conflict('This action requires the exam to be in DRAFT status.');
      }
      await tx.exam.delete({ where: { id } });
    });
  }

  async listQuestions(examId: string, caller: CallerContext) {
    await this.assertOwnsExam(examId, caller);
    return this.prisma.examQuestion.findMany({
      where: { examId },
      orderBy: { order: 'asc' },
    });
  }

  async attachQuestions(
    examId: string,
    questionIds: string[],
    caller: CallerContext,
  ) {
    const exam = await this.assertOwnsExam(examId, caller, ExamStatus.DRAFT);
    return this.prisma.$transaction(async (tx) => {
    await this.lockActiveParent(tx, exam, caller);
    const currentExam = await tx.exam.findUnique({ where: { id: examId }, select: { status: true } });
    if (!currentExam || currentExam.status !== ExamStatus.DRAFT) {
      throw AppException.conflict('This action requires the exam to be in DRAFT status.');
    }

    const sourceQuestions = await tx.question.findMany({
      where: { id: { in: questionIds }, deletedAt: null },
    });
    if (sourceQuestions.length !== questionIds.length)
      throw AppException.badRequest('One or more questions were not found.');

    const mismatched = sourceQuestions.some(
      (q) =>
        (exam.courseId && q.courseId !== exam.courseId) ||
        (exam.cohortId && q.cohortId !== exam.cohortId),
    );
    if (mismatched)
      throw AppException.badRequest(
        'Questions must belong to the same course or cohort as the exam.',
      );

    const currentCount = await tx.examQuestion.count({
      where: { examId },
    });

    const created = await tx.examQuestion.createManyAndReturn({
      data: sourceQuestions.map((q, index) => ({
        examId,
        sourceQuestionId: q.id,
        type: q.type,
        prompt: q.prompt,
        options: q.options ?? undefined,
        correctAnswer: q.correctAnswer ?? undefined,
        correctAnswerCount: q.correctAnswerCount,
        points: q.points,
        order: currentCount + index + 1,
      })),
    });

    return { questions: created };
    });
  }

  async detachQuestion(
    examId: string,
    questionId: string,
    caller: CallerContext,
  ) {
    await this.assertOwnsExam(examId, caller, ExamStatus.DRAFT);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "Exam" WHERE id = ${examId} FOR UPDATE`);
      const current = await tx.exam.findUnique({ where: { id: examId }, select: { status: true } });
      if (!current || current.status !== ExamStatus.DRAFT) {
        throw AppException.conflict('This action requires the exam to be in DRAFT status.');
      }
      const link = await tx.examQuestion.findFirst({ where: { examId, id: questionId } });
      if (!link) throw AppException.notFound('Question is not attached to this exam.');
      await tx.examQuestion.delete({ where: { id: link.id } });
    });
  }

  async assignInvigilator(
    examId: string,
    invigilatorId: string,
    caller: ScopedCallerContext,
  ) {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      select: {
        courseId: true,
        cohortId: true,
        status: true,
        scheduledStart: true,
        course: { select: { orgUnitId: true, status: true } },
        cohort: { select: { orgUnitId: true, status: true } },
      },
    });
    if (!exam) throw AppException.notFound('Exam not found.');
    if (exam.course?.status === 'ARCHIVED' || exam.cohort?.status === 'ARCHIVED') {
      throw AppException.conflict('Staff cannot be assigned to an exam belonging to an archived course or cohort.');
    }

    const scopedOrgUnitIds = await this.orgUnitsService.getScopedIds(
      caller.orgUnitId,
    );
    const examOrgUnitId = exam.course?.orgUnitId ?? exam.cohort?.orgUnitId;
    if (!examOrgUnitId || !scopedOrgUnitIds.includes(examOrgUnitId)) {
      throw AppException.forbidden();
    }
    if (!isInvigilatorAssignable(exam)) {
      throw AppException.conflict(
        'The invigilator can no longer be changed for this exam.',
      );
    }

    const staff = await this.prisma.staffAccount.findUnique({
      where: { id: invigilatorId },
    });
    if (
      !staff ||
      !staff.isActive ||
      !isAssignableInvigilatorRole(staff.role) ||
      !scopedOrgUnitIds.includes(staff.orgUnitId)
    ) {
      throw AppException.badRequest('Invalid invigilator.');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.lockActiveParent(tx, exam, caller);
      await this.lockExamRow(tx, examId);
      const currentExam = await tx.exam.findUnique({ where: { id: examId }, select: { status: true, scheduledStart: true, durationMinutes: true } });
      if (!currentExam || !isInvigilatorAssignable(currentExam)) {
        throw AppException.conflict('The invigilator can no longer be changed for this exam.');
      }
      const previous = await tx.examInvigilator.findFirst({
        where: { examId },
      });
      await this.lockStaffRows(tx, [previous?.invigilatorId, invigilatorId]);
      const currentStaff = await tx.staffAccount.findUnique({ where: { id: invigilatorId } });
      if (
        !currentStaff ||
        !currentStaff.isActive ||
        !isAssignableInvigilatorRole(currentStaff.role) ||
        !scopedOrgUnitIds.includes(currentStaff.orgUnitId)
      ) {
        throw AppException.badRequest('Invalid invigilator.');
      }
      if (currentExam.status === ExamStatus.RELEASED && currentExam.scheduledStart) {
        await this.assertNoOverlappingReleasedExam(
          tx,
          examId,
          invigilatorId,
          currentExam.scheduledStart,
          currentExam.durationMinutes ?? 180,
        );
      }
      if (previous && previous.invigilatorId !== invigilatorId) {
        await this.auditService.log(
          {
            actorId: caller.staffId,
            action: AuditAction.INVIGILATOR_REMOVED,
            entityType: 'StaffAccount',
            entityId: previous.invigilatorId,
            metadata: { examId },
          },
          tx,
        );
      }
      const assignment = await tx.examInvigilator.upsert({
        where: { examId },
        update: { invigilatorId },
        create: { examId, invigilatorId },
      });
      if (!previous || previous.invigilatorId !== invigilatorId) {
        await this.auditService.log(
          {
            actorId: caller.staffId,
            action: AuditAction.INVIGILATOR_ASSIGNED,
            entityType: 'StaffAccount',
            entityId: invigilatorId,
            metadata: { examId },
          },
          tx,
        );
      }
      return assignment;
    });
  }

  async release(examId: string, caller: CallerContext) {
    const exam = await this.assertOwnsExam(examId, caller, ExamStatus.DRAFT);
    return this.prisma.$transaction(async (tx) => {
      await this.lockActiveParent(tx, exam, caller);
      await this.lockExamRow(tx, examId);
      const current = await tx.exam.findUnique({ where: { id: examId } });
      if (!current || current.status !== ExamStatus.DRAFT) {
        throw AppException.conflict('This action requires the exam to be in DRAFT status.');
      }
      if (!current.scheduledStart) {
        throw AppException.badRequest('An exam start date and time are required before release.');
      }
      if (current.scheduledStart.getTime() <= Date.now()) {
        throw AppException.badRequest('An exam cannot be released after its scheduled start time.');
      }

      const assignment = await tx.examInvigilator.findFirst({ where: { examId } });
      if (assignment) {
        await this.lockStaffRows(tx, [assignment.invigilatorId]);
        await this.assertNoOverlappingReleasedExam(
          tx,
          examId,
          assignment.invigilatorId,
          current.scheduledStart,
          current.durationMinutes ?? 180,
        );
      }

      const rosterStudentIds = current.courseId
        ? (await tx.enrollment.findMany({
            where: { courseId: current.courseId, deletedAt: null },
            select: { studentId: true },
          })).map((enrollment) => enrollment.studentId)
        : (await tx.cohortMember.findMany({
            where: { cohortId: current.cohortId!, deletedAt: null },
            select: { studentId: true },
          })).map((member) => member.studentId);

      const otp = generateOtp();
      const otpExpiresAt = new Date(
        current.scheduledStart.getTime() + (current.durationMinutes ?? 180) * 60 * 1000,
      );
      await tx.examRoster.createMany({ data: rosterStudentIds.map((studentId) => ({ examId, studentId })) });
      await tx.examOTP.create({ data: { examId, code: otp, expiresAt: otpExpiresAt } });
      const updatedExam = await tx.exam.update({
        where: { id: examId },
        data: { status: ExamStatus.RELEASED, releasedAt: new Date() },
      });
      await this.auditService.log({
        actorId: caller.staffId,
        action: AuditAction.EXAM_RELEASED,
        entityType: 'Exam',
        entityId: examId,
      }, tx);
      return { exam: updatedExam, otpExpiresAt };
    });
  }

  async close(examId: string, caller: CallerContext) {
    await this.assertOwnsExam(examId, caller, ExamStatus.RELEASED);
    const closed = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "Exam" WHERE id = ${examId} FOR UPDATE`);
      const current = await tx.exam.findUnique({ where: { id: examId }, select: { status: true } });
      if (!current || current.status !== ExamStatus.RELEASED) {
        throw AppException.conflict('This action requires the exam to be in RELEASED status.');
      }

      const ungraded = await tx.answer.findFirst({
        where: { examQuestion: { examId, type: QuestionType.WORKOUT }, gradedAt: null },
        select: { id: true },
      });
      if (ungraded) {
        throw AppException.conflict('All manually-graded answers must be graded before closing this exam.');
      }

      const closedAt = new Date();
      const transitioned = await tx.exam.updateMany({
        where: { id: examId, status: ExamStatus.RELEASED },
        data: { status: ExamStatus.CLOSED, closedAt },
      });
      if (transitioned.count !== 1) {
        throw AppException.conflict('This action requires the exam to be in RELEASED status.');
      }

      const forcedSessionIds = await this.sessionsService.forceSubmitForExam(examId, tx);
      const updated = await tx.exam.findUniqueOrThrow({ where: { id: examId } });
      await this.auditService.log(
        {
          actorId: caller.staffId,
          action: AuditAction.EXAM_CLOSED,
          entityType: 'Exam',
          entityId: examId,
          metadata: { forceSubmittedSessionCount: forcedSessionIds.length },
        },
        tx,
      );
      return updated;
    });
    return closed;
  }

  private async lockActiveParent(
    tx: Prisma.TransactionClient,
    exam: { courseId: string | null; cohortId: string | null },
    caller: CallerContext,
  ) {
    if (exam.courseId) {
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "Course" WHERE id = ${exam.courseId} FOR UPDATE`);
      const course = await tx.course.findUnique({ where: { id: exam.courseId }, select: { status: true, instructorId: true } });
      if (!course || course.status !== 'ACTIVE') {
        throw AppException.conflict('This course is archived and cannot be used for new exam activity.');
      }
      if (caller.role === StaffRole.INSTRUCTOR && course.instructorId !== caller.staffId) throw AppException.forbidden();
    }
    if (exam.cohortId) {
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "Cohort" WHERE id = ${exam.cohortId} FOR UPDATE`);
      const cohort = await tx.cohort.findUnique({ where: { id: exam.cohortId }, select: { status: true, coordinatorId: true } });
      if (!cohort || cohort.status !== 'ACTIVE') {
        throw AppException.conflict('This cohort is archived and cannot be used for new exam activity.');
      }
      if (caller.role === StaffRole.EXIT_EXAM_COORDINATOR && cohort.coordinatorId !== caller.staffId) throw AppException.forbidden();
    }
  }

  private async lockExamRow(tx: Prisma.TransactionClient, examId: string) {
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "Exam" WHERE id = ${examId} FOR UPDATE`);
  }

  private async lockStaffRows(tx: Prisma.TransactionClient, staffIds: Array<string | undefined>) {
    for (const staffId of [...new Set(staffIds.filter((id): id is string => Boolean(id)))].sort()) {
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "StaffAccount" WHERE id = ${staffId} FOR UPDATE`);
    }
  }

  private async assertNoOverlappingReleasedExam(
    tx: Prisma.TransactionClient,
    examId: string,
    invigilatorId: string,
    scheduledStart: Date,
    durationMinutes: number,
  ) {
    const scheduledEnd = new Date(scheduledStart.getTime() + durationMinutes * 60_000);
    const [conflict] = await tx.$queryRaw<Array<{ id: string; title: string }>>(Prisma.sql`
      SELECT e.id, e.title
      FROM "ExamInvigilator" AS ei
      INNER JOIN "Exam" AS e ON e.id = ei."examId"
      WHERE ei."invigilatorId" = ${invigilatorId}
        AND ei."examId" <> ${examId}
        AND e.status = ${ExamStatus.RELEASED}::"ExamStatus"
        AND e."scheduledStart" < ${scheduledEnd}
        AND e."scheduledStart" + (COALESCE(e."durationMinutes", 180) * INTERVAL '1 minute') > ${scheduledStart}
      LIMIT 1
    `);
    if (conflict) {
      throw AppException.conflict(
        'This invigilator is already assigned to an active exam scheduled during this time. Select a different invigilator.',
      );
    }
  }

  async getOtp(examId: string, staffId: string) {
    await this.assertIsAssignedInvigilator(examId, staffId);

    const exam = await this.prisma.exam.findUniqueOrThrow({
      where: { id: examId },
    });
    const visibleFrom = new Date(
      exam.scheduledStart!.getTime() - 5 * 60 * 1000,
    );
    if (new Date() < visibleFrom) {
      throw AppException.forbidden(
        `The OTP will be visible starting ${visibleFrom.toISOString()}.`,
      );
    }

    const otp = await this.prisma.examOTP.findUnique({ where: { examId } });
    if (!otp)
      throw AppException.notFound('This exam has not been released yet.');
    return { otp: otp.code, expiresAt: otp.expiresAt };
  }

  async getRoster(examId: string, staffId: string) {
    await this.assertIsAssignedInvigilator(examId, staffId);
    return this.prisma.examSession.findMany({
      where: { examId },
      include: { student: true, incidents: { where: { resolvedAt: null } } },
    });
  }

  private buildAccessWhere(caller: CallerContext) {
    if (caller.role === StaffRole.INSTRUCTOR)
      return { course: { instructorId: caller.staffId } };
    if (caller.role === StaffRole.EXIT_EXAM_COORDINATOR)
      return { cohort: { coordinatorId: caller.staffId } };
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
        ? (
            await this.prisma.course.findUnique({
              where: { id: exam.courseId },
            })
          )?.instructorId
        : (
            await this.prisma.cohort.findUnique({
              where: { id: exam.cohortId! },
            })
          )?.coordinatorId;
      if (ownerId === caller.staffId) return exam;
    }

    const assignment = await this.prisma.examInvigilator.findFirst({
      where: { examId, invigilatorId: caller.staffId },
    });
    if (!assignment) throw AppException.forbidden();

    return exam;
  }

  private async assertOwnsExam(
    examId: string,
    caller: CallerContext,
    requiredStatus?: ExamStatus,
  ) {
    const exam = await this.prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) throw AppException.notFound('Exam not found.');

    const ownsAsInstructor =
      caller.role === StaffRole.INSTRUCTOR &&
      exam.courseId &&
      (await this.prisma.course.findUnique({ where: { id: exam.courseId } }))
        ?.instructorId === caller.staffId;

    const ownsAsCoordinator =
      caller.role === StaffRole.EXIT_EXAM_COORDINATOR &&
      exam.cohortId &&
      (await this.prisma.cohort.findUnique({ where: { id: exam.cohortId } }))
        ?.coordinatorId === caller.staffId;

    if (!ownsAsInstructor && !ownsAsCoordinator) throw AppException.forbidden();
    if (requiredStatus && exam.status !== requiredStatus) {
      throw AppException.conflict(
        `This action requires the exam to be in ${requiredStatus} status.`,
      );
    }
    return exam;
  }

  private async assertParentActive(exam: { courseId: string | null; cohortId: string | null }) {
    if (exam.courseId) {
      const course = await this.prisma.course.findUnique({ where: { id: exam.courseId }, select: { status: true } });
      if (course?.status === 'ARCHIVED') {
        throw AppException.conflict('This exam cannot be changed while its course is archived.');
      }
    }
    if (exam.cohortId) {
      const cohort = await this.prisma.cohort.findUnique({ where: { id: exam.cohortId }, select: { status: true } });
      if (cohort?.status === 'ARCHIVED') {
        throw AppException.conflict('This exam cannot be changed while its cohort is archived.');
      }
    }
  }

  private async assertIsAssignedInvigilator(examId: string, staffId: string) {
    const assignment = await this.prisma.examInvigilator.findFirst({
      where: { examId, invigilatorId: staffId },
    });
    if (!assignment) throw AppException.forbidden();
  }
}
