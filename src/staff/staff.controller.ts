import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators/auth.decorator.js';
import type { JwtPayload } from '../auth/validation/auth.interface.js';
import { StaffRole } from '../generated/prisma/client.js';
import { CreateStaffDto } from './dto/create-staff.dto.js';
import { StaffQueryDto } from './dto/staff-query.dto.js';
import { UpdateProfileDto, UpdateStaffDto } from './dto/update-staff.dto.js';
import { StaffService } from './staff.service.js';

@Controller('staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Post()
  @Roles(StaffRole.EXAM_ADMIN)
  create(@Body() dto: CreateStaffDto, @CurrentUser() user: JwtPayload) {
    return this.staffService.create(dto, user.sub);
  }

  @Get()
  @Roles(StaffRole.EXAM_ADMIN, StaffRole.INSTRUCTOR, StaffRole.EXIT_EXAM_COORDINATOR)
  async findAll(@Query() query: StaffQueryDto, @CurrentUser() user: JwtPayload) {
    return this.staffService.findAll(query, user.role);
  }

  @Get('me')
  @Roles(...Object.values(StaffRole))
  findMe(@CurrentUser() user: JwtPayload) {
    return this.staffService.findOne(user.sub);
  }

  @Patch('me')
  @Roles(...Object.values(StaffRole))
  updateMe(@Body() dto: UpdateProfileDto, @CurrentUser() user: JwtPayload) {
    return this.staffService.update(user.sub, dto, user.sub);
  }

  @Get(':id')
  @Roles(StaffRole.EXAM_ADMIN)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.staffService.findOne(id);
  }

  @Patch(':id')
  @Roles(StaffRole.EXAM_ADMIN)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStaffDto, @CurrentUser() user: JwtPayload) {
    return this.staffService.update(id, dto, user.sub);
  }

  @Delete(':id/courses/:courseId')
  @Roles(StaffRole.EXAM_ADMIN)
  unassignCourse(@Param('id', ParseUUIDPipe) id: string, @Param('courseId', ParseUUIDPipe) courseId: string) {
    return this.staffService.unassignCourse(id, courseId);
  }

  @Delete(':id/cohorts/:cohortId')
  @Roles(StaffRole.EXAM_ADMIN)
  unassignCohort(@Param('id', ParseUUIDPipe) id: string, @Param('cohortId', ParseUUIDPipe) cohortId: string) {
    return this.staffService.unassignCohort(id, cohortId);
  }
}
