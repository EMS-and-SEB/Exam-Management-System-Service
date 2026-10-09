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
  @Roles(StaffRole.SUPER_ADMIN)
  create(@Body() dto: CreateStaffDto, @CurrentUser() user: JwtPayload) {
    return this.staffService.create(dto, user);
  }

  @Get()
  @Roles(StaffRole.SUPER_ADMIN, StaffRole.UNIT_ADMIN, StaffRole.INSTRUCTOR, StaffRole.EXIT_EXAM_COORDINATOR)
  async findAll(@Query() query: StaffQueryDto, @CurrentUser() user: JwtPayload) {
    return this.staffService.findAll(query, user);
  }

  @Get('me')
  @Roles(...Object.values(StaffRole))
  findMe(@CurrentUser() user: JwtPayload) {
    return this.staffService.findOne(user.sub, user);
  }

  @Patch('me')
  @Roles(...Object.values(StaffRole))
  updateMe(@Body() dto: UpdateProfileDto, @CurrentUser() user: JwtPayload) {
    return this.staffService.update(user.sub, dto, user);
  }

  @Get(':id')
  @Roles(StaffRole.SUPER_ADMIN, StaffRole.UNIT_ADMIN)
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.staffService.findOne(id, user);
  }

  @Patch(':id')
  @Roles(StaffRole.SUPER_ADMIN)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStaffDto, @CurrentUser() user: JwtPayload) {
    return this.staffService.update(id, dto, user);
  }

  @Delete(':id/courses/:courseId')
  @Roles(StaffRole.SUPER_ADMIN, StaffRole.UNIT_ADMIN)
  unassignCourse(@Param('id', ParseUUIDPipe) id: string, @Param('courseId', ParseUUIDPipe) courseId: string) {
    return this.staffService.unassignCourse(id, courseId);
  }

  @Delete(':id/cohorts/:cohortId')
  @Roles(StaffRole.SUPER_ADMIN, StaffRole.UNIT_ADMIN)
  unassignCohort(@Param('id', ParseUUIDPipe) id: string, @Param('cohortId', ParseUUIDPipe) cohortId: string) {
    return this.staffService.unassignCohort(id, cohortId);
  }
}