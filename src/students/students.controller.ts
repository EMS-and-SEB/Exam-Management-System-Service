import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../auth/decorators/auth.decorator.js';
import { AppException } from '../common/exceptions/app-exceptions.js';
import { StaffRole } from '../generated/prisma/client.js';
import { CreateStudentDto } from './dto/create-student.dto.js';
import { StudentQueryDto } from './dto/student-query.dto.js';
import { UpdateStudentDto } from './dto/update-student.dto.js';
import { StudentsService } from './students.service.js';

@Controller('students')
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Post()
  @Roles(StaffRole.EXAM_ADMIN)
  async create(@Body() dto: CreateStudentDto) {
    return this.studentsService.create(dto);
  }

  @Post('bulk')
  @Roles(StaffRole.EXAM_ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  async bulkImport(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw AppException.badRequest('No file uploaded.');
    }
    if (file.mimetype !== 'text/csv' && !file.originalname.endsWith('.csv')) {
      throw AppException.badRequest('Only CSV files are allowed.');
    }
    return this.studentsService.bulkImport(file.buffer);
  }

  @Get()
  @Roles(
    StaffRole.EXAM_ADMIN,
    StaffRole.INSTRUCTOR,
    StaffRole.EXIT_EXAM_COORDINATOR,
  )
  async findAll(@Query() query: StudentQueryDto) {
    return this.studentsService.findAll(query);
  }

  @Get(':id')
  @Roles(
    StaffRole.EXAM_ADMIN,
    StaffRole.INSTRUCTOR,
    StaffRole.EXIT_EXAM_COORDINATOR,
  )
  async findOne(@Param('id') id: string) {
    if (!this.isValidUuid(id)) {
      throw AppException.badRequest('Invalid ID format.');
    }
    return this.studentsService.findOne(id);
  }

  @Patch(':id')
  @Roles(StaffRole.EXAM_ADMIN)
  async update(@Param('id') id: string, @Body() dto: UpdateStudentDto) {
    if (!this.isValidUuid(id)) {
      throw AppException.badRequest('Invalid ID format.');
    }
    return this.studentsService.update(id, dto);
  }

  private isValidUuid(id: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      id,
    );
  }
}
