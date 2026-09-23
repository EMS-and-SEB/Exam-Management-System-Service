import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CoursesService } from './courses.service.js';
import { Roles } from '../auth/decorators/auth.decorator.js'; 
import { CurrentUser } from '../auth/decorators/auth.decorator.js';
import type { JwtPayload } from '../auth/validation/auth.interface.js';
import { StaffRole } from '../generated/prisma/client.js';
import { CreateCourseDto, UpdateCourseDto, EnrollStudentDto, EnrollSelectedDto } from "./dto/course.dto.js";
import { AppException } from '../common/exceptions/app-exceptions.js';

@Controller('courses')
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}
  
  @Roles(StaffRole.EXAM_ADMIN)
  @Post()
  create(@Body() dto: CreateCourseDto, @CurrentUser() user: JwtPayload) {
    return this.coursesService.create(dto.name, dto.instructorId, user.sub);
  }

  @Roles(StaffRole.EXAM_ADMIN)
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCourseDto, @CurrentUser() user: JwtPayload) {
    return this.coursesService.update(id, dto, user.sub);
  }

  @Roles(StaffRole.EXAM_ADMIN, StaffRole.INSTRUCTOR)
  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.coursesService.findAll({ staffId: user.sub, role: user.role });
  }

  @Roles(StaffRole.EXAM_ADMIN, StaffRole.INSTRUCTOR)
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.coursesService.findOne(id, { staffId: user.sub, role: user.role });
  }

  @Roles(StaffRole.INSTRUCTOR, StaffRole.EXAM_ADMIN)
  @Post(':id/enrollments')
  enrollOne(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EnrollStudentDto, @CurrentUser() user: JwtPayload) {
    return this.coursesService.enrollOne(id, dto.studentId, dto.name, { staffId: user.sub, role: user.role });
  }

  @Roles(StaffRole.INSTRUCTOR, StaffRole.EXAM_ADMIN)
  @Post(':id/enrollments/select')
  enrollSelected(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EnrollSelectedDto, @CurrentUser() user: JwtPayload) {
    return this.coursesService.enrollSelected(id, dto.studentIds, { staffId: user.sub, role: user.role });
  }

  @Roles(StaffRole.INSTRUCTOR, StaffRole.EXAM_ADMIN)
  @Post(':id/enrollments/bulk')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  enrollBulk(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!file) throw AppException.badRequest('A CSV file is required.');
    return this.coursesService.enrollBulk(id, file, { staffId: user.sub, role: user.role });
  }

  @Roles(StaffRole.INSTRUCTOR, StaffRole.EXAM_ADMIN)
  @Get(':id/enrollments')
  listEnrollments(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.coursesService.listEnrollments(id, { staffId: user.sub, role: user.role });
  }

  @Roles(StaffRole.INSTRUCTOR, StaffRole.EXAM_ADMIN)
  @Delete(':id/enrollments/:studentId')
  async removeEnrollment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('studentId') studentId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.coursesService.removeEnrollment(id, studentId, { staffId: user.sub, role: user.role });
    return { success: true };
  }
}