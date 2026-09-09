import { Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
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

  @Post()
  @Roles(StaffRole.EXAM_ADMIN)
  async create(@Body() dto: CreateCohortDto) { return this.cohortsService.create(dto.name, dto.coordinatorId); }

  @Get()
  @Roles(StaffRole.EXAM_ADMIN, StaffRole.EXIT_EXAM_COORDINATOR)
  async findAll(@CurrentUser() user: JwtPayload) {     return this.cohortsService.findAll({ staffId: user.sub, role: user.role });
 }

  @Get(':id')
  @Roles(StaffRole.EXAM_ADMIN, StaffRole.EXIT_EXAM_COORDINATOR)
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
      return this.cohortsService.findOne(id, { staffId: user.sub, role: user.role });
    }

  @Patch(':id')
  @Roles(StaffRole.EXAM_ADMIN)
  async update(@Param('id') id: string, @Body() dto: UpdateCohortDto) { return this.cohortsService.update(id, dto); }

  @Post(':id/members/bulk')
  @Roles(StaffRole.EXIT_EXAM_COORDINATOR)
  @UseInterceptors(FileInterceptor('file'))
  addBulk(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!file) throw AppException.badRequest('A CSV file is required.');
    return this.cohortsService.addBulk(id, file, { staffId: user.sub, role: user.role });
  }

  @Post(':id/members')
  @Roles(StaffRole.EXIT_EXAM_COORDINATOR)
  async add(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: AddMemberDto) {
    return this.cohortsService.addOne(id, dto.studentId, dto.name, { staffId: user.sub, role: user.role });
  }

  @Post(':id/members/select')
  @Roles(StaffRole.EXIT_EXAM_COORDINATOR)
  addSelected(@Param('id') id: string, @Body() dto: AddMembersSelectedDto, @CurrentUser() user: JwtPayload) {
    return this.cohortsService.addSelected(id, dto.studentIds, { staffId: user.sub, role: user.role });
  }

  @Get(':id/members')
  @Roles(StaffRole.EXAM_ADMIN, StaffRole.EXIT_EXAM_COORDINATOR)
  listMembers(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.cohortsService.listMembers(id, { staffId: user.sub, role: user.role });
  }

  @Delete(':id/members/:studentId')
  @Roles(StaffRole.EXIT_EXAM_COORDINATOR)
  async removeMember(
    @Param('id') id: string,
    @Param('studentId') studentId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.cohortsService.removeMember(id, studentId, { staffId: user.sub, role: user.role });
    return { success: true };
  }
}
