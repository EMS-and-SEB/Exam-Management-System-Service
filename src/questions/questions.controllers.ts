import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators/auth.decorator.js';
import { StaffRole } from '../generated/prisma/client.js';
import type { JwtPayload } from '../auth/validation/auth.interface.js';
import { QuestionsService } from './questions.service.js';
import { CreateQuestionsDto, UpdateQuestionDto } from './validation/questions.dto.js';

@Controller()
export class QuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  @Post('courses/:courseId/questions')
  @Roles(StaffRole.INSTRUCTOR)
  createForCourse(
    @Param('courseId') courseId: string,
    @Body() dto: CreateQuestionsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.questionsService.createMany({ courseId }, dto.type, dto.questions, {
      staffId: user.sub,
      role: user.role,
    });
  }

  @Get('courses/:courseId/questions')
  @Roles(StaffRole.INSTRUCTOR)
  async listCourse(@Param('courseId') courseId: string, @CurrentUser() user: JwtPayload) {
    return this.questionsService.findAllForParent({ courseId }, { staffId: user.sub, role: user.role });
  }

  @Post('cohorts/:cohortId/questions')
  @Roles(StaffRole.EXIT_EXAM_COORDINATOR)
   createForCohort(
    @Param('cohortId') cohortId: string,
    @Body() dto: CreateQuestionsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.questionsService.createMany({ cohortId }, dto.type, dto.questions, {
      staffId: user.sub,
      role: user.role,
    });
  }

  @Get('cohorts/:cohortId/questions')
  @Roles(StaffRole.EXIT_EXAM_COORDINATOR)
  async listCohort(@Param('cohortId') cohortId: string, @CurrentUser() user: JwtPayload) {
    return this.questionsService.findAllForParent({ cohortId }, { staffId: user.sub, role: user.role });
  }

  @Roles(StaffRole.INSTRUCTOR, StaffRole.EXIT_EXAM_COORDINATOR)
  @Get('questions/:questionId')
  findOne(@Param('questionId') questionId: string, @CurrentUser() user: JwtPayload) {
    return this.questionsService.findOne(questionId, { staffId: user.sub, role: user.role });
  }

  @Roles(StaffRole.INSTRUCTOR, StaffRole.EXIT_EXAM_COORDINATOR)
  @Patch('questions/:questionId')
  update(
    @Param('questionId') questionId: string,
    @Body() dto: UpdateQuestionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.questionsService.update(questionId, dto, { staffId: user.sub, role: user.role });
  }

  @Roles(StaffRole.INSTRUCTOR, StaffRole.EXIT_EXAM_COORDINATOR)
  @Delete('questions/:questionId')
  async remove(@Param('questionId') questionId: string, @CurrentUser() user: JwtPayload) {
    await this.questionsService.remove(questionId, { staffId: user.sub, role: user.role });
    return { success: true };
  }
}