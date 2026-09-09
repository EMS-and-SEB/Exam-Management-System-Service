import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/auth.decorator.js';
import { AppException } from '../common/exceptions/app-exceptions.js';
import { StaffRole } from '../generated/prisma/client.js';
import { CreateStaffDto } from './dto/create-staff.dto.js';
import { StaffQueryDto } from './dto/staff-query.dto.js';
import { UpdateStaffDto } from './dto/update-staff.dto.js';
import { StaffService } from './staff.service.js';

@Controller('staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Post()
  @Roles(StaffRole.EXAM_ADMIN)
  async create(@Body() dto: CreateStaffDto) {
    return this.staffService.create(dto);
  }

  @Get()
  @Roles(StaffRole.EXAM_ADMIN)
  async findAll(@Query() query: StaffQueryDto) {
    return this.staffService.findAll(query);
  }

  @Get(':id')
  @Roles(StaffRole.EXAM_ADMIN)
  async findOne(@Param('id') id: string) {
    if (!this.isValidUuid(id)) {
      throw AppException.badRequest('Invalid ID format.');
    }
    return this.staffService.findOne(id);
  }

  @Patch(':id')
  @Roles(StaffRole.EXAM_ADMIN)
  async update(@Param('id') id: string, @Body() dto: UpdateStaffDto) {
    if (!this.isValidUuid(id)) {
      throw AppException.badRequest('Invalid ID format.');
    }
    return this.staffService.update(id, dto);
  }

  private isValidUuid(id: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      id,
    );
  }
}
