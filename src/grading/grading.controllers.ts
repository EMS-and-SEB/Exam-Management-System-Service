import { Body, Controller, Get, Param, Patch, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../auth/decorators/auth.decorator.js';
import type { JwtPayload } from '../auth/validation/auth.interface.js';
import { AppException } from '../common/exceptions/app-exceptions.js';
import { StaffRole } from '../generated/prisma/client.js';
import { GradingService } from './grading.service.js';
import { GradeAnswerDto } from './validation/grading.dto.js';

const ALLOWED_GRADING_ROLES = [
  StaffRole.INSTRUCTOR,
  StaffRole.EXIT_EXAM_COORDINATOR,
];

function assertUuid(id: string) {
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(id)) {
    throw AppException.badRequest('Invalid ID format.');
  }
}

// ---------- /exams/:id/sessions, /exams/:id/results/export ----------
@Controller('exams')
export class ExamResultsController {
  constructor(private readonly grading: GradingService) {}

  @Get(':id/sessions')
  @Roles(...ALLOWED_GRADING_ROLES)
  async listSessions(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    assertUuid(id);
    return this.grading.listExamSessions(id, user);
  }

  @Get(':id/results/export')
  @Roles(...ALLOWED_GRADING_ROLES)
  async exportExam(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    assertUuid(id);
    const csv = await this.grading.exportExamResults(id, user);
    res.header('Content-Type', 'text/csv');
    res.header(
      'Content-Disposition',
      `attachment; filename="exam-${id}-results.csv"`,
    );
    return csv;
  }
}

// ---------- /sessions/:id/answers ----------
@Controller('sessions')
export class SessionAnswersController {
  constructor(private readonly grading: GradingService) {}

  @Get(':id/answers')
  @Roles(...ALLOWED_GRADING_ROLES)
  async listAnswers(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    assertUuid(id);
    return this.grading.listSessionAnswers(id, user);
  }
}

// ---------- /answers/:id/grade ----------
@Controller('answers')
export class AnswerGradingController {
  constructor(private readonly grading: GradingService) {}

  @Patch(':id/grade')
  @Roles(...ALLOWED_GRADING_ROLES)
  async grade(
    @Param('id') id: string,
    @Body() dto: GradeAnswerDto,
    @CurrentUser() user: JwtPayload,
  ) {
    assertUuid(id);
    return this.grading.gradeAnswer(id, dto, user);
  }
}

// ---------- /courses/:id/results/export ----------
@Controller('courses')
export class CourseResultsController {
  constructor(private readonly grading: GradingService) {}

  @Get(':id/results/export')
  @Roles(StaffRole.INSTRUCTOR)
  async export(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    assertUuid(id);
    const csv = await this.grading.exportCourseResults(id, user);
    res.header('Content-Type', 'text/csv');
    res.header(
      'Content-Disposition',
      `attachment; filename="course-${id}-results.csv"`,
    );
    return csv;
  }
}

// ---------- /cohorts/:id/results, /cohorts/:id/results/export ----------
@Controller('cohorts')
export class CohortResultsController {
  constructor(private readonly grading: GradingService) {}

  @Get(':id/results')
  @Roles(StaffRole.EXIT_EXAM_COORDINATOR)
  async results(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    assertUuid(id);
    return this.grading.cohortResults(id, user);
  }

  @Get(':id/results/export')
  @Roles(StaffRole.EXIT_EXAM_COORDINATOR)
  async export(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    assertUuid(id);
    const csv = await this.grading.exportCohortResults(id, user);
    res.header('Content-Type', 'text/csv');
    res.header(
      'Content-Disposition',
      `attachment; filename="cohort-${id}-results.csv"`,
    );
    return csv;
  }
}
