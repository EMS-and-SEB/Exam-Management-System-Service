import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async bulkImport(@UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw AppException.badRequest('No file uploaded.');
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
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.studentsService.findOne(id);
  }

  @Patch(':id')
  @Roles(StaffRole.EXAM_ADMIN)
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStudentDto) {
    return this.studentsService.update(id, dto);
  }
}
