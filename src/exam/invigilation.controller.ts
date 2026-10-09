import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ExamService } from './exam.service.js';
import { CurrentUser, Roles } from '../auth/decorators/auth.decorator.js';
import type { JwtPayload } from '../auth/validation/auth.interface.js';
import { StaffRole } from '../generated/prisma/client.js';

@Controller('invigilation/exams')
@Roles(StaffRole.INVIGILATOR, StaffRole.INSTRUCTOR, StaffRole.EXIT_EXAM_COORDINATOR)
export class InvigilationController {
  constructor(private readonly examService: ExamService) {}

  @Get()
  listAssigned(@CurrentUser() user: JwtPayload) {
    return this.examService.listAssignedInvigilationExams(user.sub);
  }

  @Get(':id')
  getAssigned(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.examService.getAssignedInvigilationExam(id, user.sub);
  }

  @Get(':id/otp')
  getOtp(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.examService.getOtp(id, user.sub);
  }

  @Get(':id/roster')
  getRoster(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.examService.getRoster(id, user.sub);
  }
}
