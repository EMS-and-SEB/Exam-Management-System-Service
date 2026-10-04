import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorator.js';
import { UserRole } from '../../auth/validation/auth.interface.js';
import type { JwtPayload } from '../../auth/validation/auth.interface.js';
import { PortalExamsService } from '../services/portal-exams.service.js';
import { ExamInquiryDto } from '../validation/exam-inquiry.dto.js';

@Roles(UserRole.STUDENT)
@Controller('portal/exams')
export class PortalExamsController {
  constructor(private readonly portalExamsService: PortalExamsService) {}

  @Get('incoming')
  getIncomingExams(@CurrentUser() user: JwtPayload) {
    return this.portalExamsService.getIncomingExams(user.sub);
  }

  @Get('results')
  getExamResults(@CurrentUser() user: JwtPayload) {
    return this.portalExamsService.getExamResults(user.sub);
  }

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
