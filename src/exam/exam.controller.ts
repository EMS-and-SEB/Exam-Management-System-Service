import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ExamService } from './exam.service.js';
import { Roles, CurrentUser } from '../auth/decorators/auth.decorator.js';
import type { JwtPayload } from '../auth/validation/auth.interface.js';
import { StaffRole } from '../generated/prisma/client.js';
import { CreateExamDto, UpdateExamDto, AttachQuestionsDto, AssignInvigilatorDto } from './validation/exam.dto.js';

@Controller('exams')
export class ExamController {
  constructor(private readonly examService: ExamService) {}

  @Roles(StaffRole.INSTRUCTOR, StaffRole.EXIT_EXAM_COORDINATOR)
  @Post()
  create(@Body() dto: CreateExamDto, @CurrentUser() user: JwtPayload) {
    return this.examService.create(dto, { staffId: user.sub, role: user.role });
  }

  @Get()
  findAll(
    @Query('courseId') courseId: string | undefined,
    @Query('cohortId') cohortId: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.examService.findAll({ staffId: user.sub, role: user.role }, { courseId, cohortId });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.examService.findOne(id, { staffId: user.sub, role: user.role });
  }

  @Roles(StaffRole.INSTRUCTOR, StaffRole.EXIT_EXAM_COORDINATOR)
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateExamDto, @CurrentUser() user: JwtPayload) {
    return this.examService.update(id, dto, { staffId: user.sub, role: user.role });
  }

  @Roles(StaffRole.INSTRUCTOR, StaffRole.EXIT_EXAM_COORDINATOR)
  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    await this.examService.remove(id, { staffId: user.sub, role: user.role });
    return { success: true };
  }

  @Roles(StaffRole.INSTRUCTOR, StaffRole.EXIT_EXAM_COORDINATOR)
  @Get(':id/questions')
  listQuestions(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.examService.listQuestions(id, { staffId: user.sub, role: user.role });
  }

  @Roles(StaffRole.INSTRUCTOR, StaffRole.EXIT_EXAM_COORDINATOR)
  @Post(':id/questions')
  attachQuestions(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AttachQuestionsDto, @CurrentUser() user: JwtPayload) {
    return this.examService.attachQuestions(id, dto.questionIds, { staffId: user.sub, role: user.role });
  }

  @Roles(StaffRole.INSTRUCTOR, StaffRole.EXIT_EXAM_COORDINATOR)
  @Delete(':id/questions/:questionId')
  async detachQuestion(@Param('id', ParseUUIDPipe) id: string, @Param('questionId', ParseUUIDPipe) questionId: string, @CurrentUser() user: JwtPayload) {
    await this.examService.detachQuestion(id, questionId, { staffId: user.sub, role: user.role });
    return { success: true };
  }

  @Roles(StaffRole.INSTRUCTOR, StaffRole.EXIT_EXAM_COORDINATOR)
  @Post(':id/invigilators')
  assignInvigilator(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignInvigilatorDto, @CurrentUser() user: JwtPayload) {
    return this.examService.assignInvigilator(id, dto.invigilatorId, { staffId: user.sub, role: user.role });
  }

  @Roles(StaffRole.INSTRUCTOR, StaffRole.EXIT_EXAM_COORDINATOR)
  @Delete(':id/invigilators/:staffId')
  async removeInvigilator(@Param('id', ParseUUIDPipe) id: string, @Param('staffId', ParseUUIDPipe) staffId: string, @CurrentUser() user: JwtPayload) {
    await this.examService.removeInvigilator(id, staffId, { staffId: user.sub, role: user.role });
    return { success: true };
  }

  @Roles(StaffRole.INSTRUCTOR, StaffRole.EXIT_EXAM_COORDINATOR)
  @Post(':id/release')
  release(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.examService.release(id, { staffId: user.sub, role: user.role });
  }

  @Roles(StaffRole.INSTRUCTOR, StaffRole.EXIT_EXAM_COORDINATOR)
  @Post(':id/close')
  close(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.examService.close(id, { staffId: user.sub, role: user.role });
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