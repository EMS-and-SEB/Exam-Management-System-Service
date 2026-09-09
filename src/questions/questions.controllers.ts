import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators/auth.decorator.js';
import { StaffRole } from '../generated/prisma/client.js';
import type { JwtPayload } from '../auth/validation/auth.interface.js';
import { QuestionsService } from './questions.service.js';
import { CreateQuestionsDto, UpdateQuestionDto } from './validation/questions.dto.js';

@Controller()
export class QuestionsController {
  constructor(private readonly service: QuestionsService) {}

  @Post('courses/:courseId/questions')
  @Roles(StaffRole.INSTRUCTOR)
  async createCourse(@Param('courseId') courseId: string, @CurrentUser() user: JwtPayload, @Body() dto: CreateQuestionsDto) {
    return { questions: await this.service.createForCourse(courseId, user.sub, dto) };
  }

  @Get('courses/:courseId/questions')
  @Roles(StaffRole.INSTRUCTOR)
  async listCourse(@Param('courseId') courseId: string, @CurrentUser() user: JwtPayload) {
    return { questions: await this.service.listForCourse(courseId, user.sub) };
  }

  @Post('cohorts/:cohortId/questions')
  @Roles(StaffRole.EXIT_EXAM_COORDINATOR)
  async createCohort(@Param('cohortId') cohortId: string, @CurrentUser() user: JwtPayload, @Body() dto: CreateQuestionsDto) {
    return { questions: await this.service.createForCohort(cohortId, user.sub, dto) };
  }

  @Get('cohorts/:cohortId/questions')
  @Roles(StaffRole.EXIT_EXAM_COORDINATOR)
  async listCohort(@Param('cohortId') cohortId: string, @CurrentUser() user: JwtPayload) {
    return { questions: await this.service.listForCohort(cohortId, user.sub) };
  }

  @Get('questions/:questionId')
  async get(@Param('questionId') questionId: string, @CurrentUser() user: JwtPayload) {
    return { question: await this.service.get(questionId, user.sub, user.role) };
  }

  @Patch('questions/:questionId')
  async update(@Param('questionId') questionId: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdateQuestionDto) {
    return { question: await this.service.update(questionId, user.sub, user.role, dto) };
  }

  @Delete('questions/:questionId')
  async remove(@Param('questionId') questionId: string, @CurrentUser() user: JwtPayload) {
    await this.service.remove(questionId, user.sub, user.role);
    return { success: true };
  }
}
