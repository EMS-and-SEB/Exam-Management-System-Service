import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../auth/decorators/auth.decorator.js';
import type { JwtPayload } from '../auth/validation/auth.interface.js';
import { StaffRole } from '../generated/prisma/client.js';
import { GradingService } from './grading.service.js';
import { GradeAnswerDto } from './validation/grading.dto.js';

const ALLOWED_GRADING_ROLES = [
  StaffRole.INSTRUCTOR,
  StaffRole.EXIT_EXAM_COORDINATOR,
];

@Controller('exams')
export class ExamResultsController {
  constructor(private readonly grading: GradingService) {}

  @Get(':id/sessions')
  @Roles(...ALLOWED_GRADING_ROLES)
  async listSessions(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.grading.listExamSessions(id, user);
  }

  @Get(':id/results/export')
  @Roles(...ALLOWED_GRADING_ROLES)
  async exportExam(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const csv = await this.grading.exportExamResults(id, user);
    res.header('Content-Type', 'text/csv');
    res.header(
      'Content-Disposition',
      `attachment; filename="exam-${id}-results.csv"`,
    );
    return csv;
  }
}

@Controller('sessions')
export class SessionAnswersController {
  constructor(private readonly grading: GradingService) {}

  @Get(':id/answers')
  @Roles(...ALLOWED_GRADING_ROLES)
  async listAnswers(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.grading.listSessionAnswers(id, user);
  }
}

@Controller('answers')
export class AnswerGradingController {
  constructor(private readonly grading: GradingService) {}

  @Patch(':id/grade')
  @Roles(...ALLOWED_GRADING_ROLES)
  async grade(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GradeAnswerDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.grading.gradeAnswer(id, dto, user);
  }
}

@Controller('courses')
export class CourseResultsController {
  constructor(private readonly grading: GradingService) {}

  @Get(':id/results')
  @Roles(StaffRole.INSTRUCTOR)
  async results(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.grading.courseResults(id, user);
  }
  
  @Get(':id/results/export')
  @Roles(StaffRole.INSTRUCTOR)
  async export(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const csv = await this.grading.exportCourseResults(id, user);
    res.header('Content-Type', 'text/csv');
    res.header(
      'Content-Disposition',
      `attachment; filename="course-${id}-results.csv"`,
    );
    return csv;
  }
}

@Controller('cohorts')
export class CohortResultsController {
  constructor(private readonly grading: GradingService) {}

  @Get(':id/results')
  @Roles(StaffRole.EXIT_EXAM_COORDINATOR)
  async results(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.grading.cohortResults(id, user);
  }

  @Get(':id/results/export')
  @Roles(StaffRole.EXIT_EXAM_COORDINATOR)
  async export(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const csv = await this.grading.exportCohortResults(id, user);
    res.header('Content-Type', 'text/csv');
    res.header(
      'Content-Disposition',
      `attachment; filename="cohort-${id}-results.csv"`,
    );
    return csv;
  }
}
