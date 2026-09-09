import { Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser, Roles } from '../auth/decorators/auth.decorator.js';
import { StaffRole } from '../generated/prisma/client.js';
import type { JwtPayload } from '../auth/validation/auth.interface.js';
import { CohortsService } from './cohorts.service.js';
import { AddMemberDto, CreateCohortDto, SelectMembersDto, UpdateCohortDto } from './validation/cohorts.dto.js';

@Controller('cohorts')
export class CohortsController {
  constructor(private readonly service: CohortsService) {}

  @Post()
  @Roles(StaffRole.EXAM_ADMIN)
  async create(@Body() dto: CreateCohortDto) { return { cohort: await this.service.create(dto) }; }

  @Get()
  @Roles(StaffRole.EXAM_ADMIN, StaffRole.EXIT_EXAM_COORDINATOR)
  async list(@CurrentUser() user: JwtPayload) { return { cohorts: await this.service.list(user.sub, user.role) }; }

  @Get(':id')
  @Roles(StaffRole.EXAM_ADMIN, StaffRole.EXIT_EXAM_COORDINATOR)
  async get(@Param('id') id: string, @CurrentUser() user: JwtPayload) { return { cohort: await this.service.get(id, user.sub, user.role) }; }

  @Patch(':id')
  @Roles(StaffRole.EXAM_ADMIN)
  async update(@Param('id') id: string, @Body() dto: UpdateCohortDto) { return { cohort: await this.service.update(id, dto) }; }

  @Post(':id/members/bulk')
  @Roles(StaffRole.EXIT_EXAM_COORDINATOR)
  @UseInterceptors(FileInterceptor('file'))
  async bulk(@Param('id') id: string, @CurrentUser() user: JwtPayload, @UploadedFile() file: { buffer?: Buffer }) {
    return this.service.bulkMembers(id, user.sub, file);
  }

  @Post(':id/members')
  @Roles(StaffRole.EXIT_EXAM_COORDINATOR)
  async add(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: AddMemberDto) {
    return { member: await this.service.addMember(id, user.sub, dto) };
  }

  @Post(':id/members/select')
  @Roles(StaffRole.EXIT_EXAM_COORDINATOR)
  async select(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: SelectMembersDto) {
    return this.service.selectMembers(id, user.sub, dto);
  }

  @Get(':id/members')
  @Roles(StaffRole.EXAM_ADMIN, StaffRole.EXIT_EXAM_COORDINATOR)
  async members(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return { members: await this.service.listMembers(id, user.sub, user.role) };
  }

  @Delete(':id/members/:studentId')
  @Roles(StaffRole.EXIT_EXAM_COORDINATOR)
  async remove(@Param('id') id: string, @Param('studentId') studentId: string, @CurrentUser() user: JwtPayload) {
    await this.service.removeMember(id, studentId, user.sub);
    return { success: true };
  }
}
