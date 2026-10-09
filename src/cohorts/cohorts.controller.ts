import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser, Roles } from '../auth/decorators/auth.decorator.js';
import { StaffRole } from '../generated/prisma/client.js';
import type { JwtPayload } from '../auth/validation/auth.interface.js';
import { CohortsService } from './cohorts.service.js';
import { AddMemberDto, CreateCohortDto, AddMembersSelectedDto, UpdateCohortDto } from './validation/cohorts.dto.js';
import { AppException } from '../common/exceptions/app-exceptions.js';

@Controller('cohorts')
export class CohortsController {
  constructor(private readonly cohortsService: CohortsService) {}

  @Roles(StaffRole.SUPER_ADMIN, StaffRole.UNIT_ADMIN)
  @Post()
  create(@Body() dto: CreateCohortDto, @CurrentUser() user: JwtPayload) {
    return this.cohortsService.create(dto.name, dto.coordinatorId, dto.orgUnitId, { staffId: user.sub, role: user.role, orgUnitId: user.orgUnitId });
  }

  @Patch(':id')
  @Roles(StaffRole.SUPER_ADMIN, StaffRole.UNIT_ADMIN)
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCohortDto, @CurrentUser() user: JwtPayload) {
    return this.cohortsService.update(id, dto, { staffId: user.sub, role: user.role, orgUnitId: user.orgUnitId });
  }

  @Get()
  @Roles(StaffRole.SUPER_ADMIN, StaffRole.UNIT_ADMIN, StaffRole.EXIT_EXAM_COORDINATOR)
  async findAll(@CurrentUser() user: JwtPayload) {
    return this.cohortsService.findAll({ staffId: user.sub, role: user.role, orgUnitId: user.orgUnitId });
  }

  @Get(':id')
  @Roles(StaffRole.SUPER_ADMIN, StaffRole.UNIT_ADMIN, StaffRole.EXIT_EXAM_COORDINATOR)
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.cohortsService.findOne(id, { staffId: user.sub, role: user.role, orgUnitId: user.orgUnitId });
  }

  @Post(':id/members/import')
  @Roles(StaffRole.SUPER_ADMIN, StaffRole.UNIT_ADMIN)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  import(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!file) throw AppException.badRequest('A CSV file is required.');
    return this.cohortsService.import(id, file, { staffId: user.sub, role: user.role, orgUnitId: user.orgUnitId });
  }

  @Post(':id/members')
  @Roles(StaffRole.EXIT_EXAM_COORDINATOR, StaffRole.SUPER_ADMIN, StaffRole.UNIT_ADMIN)
  async add(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload, @Body() dto: AddMemberDto) {
    return this.cohortsService.addOne(id, dto.studentId, dto.name, { staffId: user.sub, role: user.role, orgUnitId: user.orgUnitId });
  }

  @Post(':id/members/select')
  @Roles(StaffRole.SUPER_ADMIN, StaffRole.UNIT_ADMIN)
  addSelected(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddMembersSelectedDto, @CurrentUser() user: JwtPayload) {
    return this.cohortsService.addSelected(id, dto.studentIds, { staffId: user.sub, role: user.role, orgUnitId: user.orgUnitId });
  }

  @Get(':id/members')
  @Roles(StaffRole.SUPER_ADMIN, StaffRole.UNIT_ADMIN, StaffRole.EXIT_EXAM_COORDINATOR)
  listMembers(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.cohortsService.listMembers(id, { staffId: user.sub, role: user.role, orgUnitId: user.orgUnitId });
  }

  @Delete(':id/members/:studentId')
  @Roles(StaffRole.EXIT_EXAM_COORDINATOR, StaffRole.SUPER_ADMIN, StaffRole.UNIT_ADMIN)
  async removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('studentId') studentId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.cohortsService.removeMember(id, studentId, { staffId: user.sub, role: user.role, orgUnitId: user.orgUnitId });
    return { success: true };
  }
}