import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Roles, CurrentUser } from '../../auth/decorators/auth.decorator.js';
import { UserRole } from '../../auth/validation/auth.interface.js';
import type { JwtPayload } from '../../auth/validation/auth.interface.js';
import { PortalExamsService } from '../services/portal-exams.service.js';
import { ExamInquiryDto } from '../validation/exam-inquiry.dto.js';

@Roles(UserRole.STUDENT)
@Controller('portal/exams')
export class PortalExamsController {
  constructor(private readonly portalExamsService: PortalExamsService) {}

  /**
   * GET /api/v1/portal/exams/incoming
   * Returns all non-closed exams across the student's enrolled courses and
   * cohorts, with an `isOnRoster` flag per exam.
   */
  @Get('incoming')
  getIncomingExams(@CurrentUser() user: JwtPayload) {
    return this.portalExamsService.getIncomingExams(user.sub);
  }

  /**
   * GET /api/v1/portal/exams/results
   * Returns completed exam sessions for the authenticated student.
   * Scores are masked with `status: "PENDING_GRADING"` whenever any WORKOUT
   * question in the exam has not yet been graded by the instructor.
   */
  @Get('results')
  getExamResults(@CurrentUser() user: JwtPayload) {
    return this.portalExamsService.getExamResults(user.sub);
  }

  /**
   * POST /api/v1/portal/exams/:examId/inquiry
   * Dispatches a student inquiry email to the exam's instructor or coordinator.
   * Rate-limited to 3 requests per 15 minutes to prevent inbox flooding.
   */
  @Throttle({ default: { limit: 3, ttl: 15 * 60_000 } })
  @Post(':examId/inquiry')
  @HttpCode(HttpStatus.OK)
  sendExamInquiry(
    @Param('examId', ParseUUIDPipe) examId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ExamInquiryDto,
  ) {
    return this.portalExamsService.sendExamInquiry(examId, user.sub, dto);
  }
}
